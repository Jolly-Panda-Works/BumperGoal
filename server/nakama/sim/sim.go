// Package sim runs FlickKick shots on Rapier inside the Nakama Go runtime.
//
// It executes the exact wasm shipped in @dimforge/rapier2d-deterministic 0.21.0
// (Rust rapier2d 0.36.0, enhanced-determinism) with wazero, and replays the raw
// wasm-bindgen calls that packages/sim/src/index.ts makes through the official
// JS API. Same bytes + same calls = bit-identical results; the shared vectors in
// packages/sim/test/vectors.json enforce it (see sim_test.go).
//
// Only physics-mutating calls have to match the JS side exactly. Read-only
// bookkeeping (forEach/contains after a JS step) is skipped here.
package sim

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"hash/fnv"
	"math"
	"strings"
	"sync"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
)

//go:embed rapier_wasm2d_bg.wasm
var rapierWasm []byte

// RapierWasmSHA256 identifies the only wasm this package may run.
const RapierWasmSHA256 = "0570d5c822275fbadbbfe4bda0c589b039c2f41259676dc53f6679085601155d"

// Version must equal SIM_VERSION in packages/sim/src/index.ts.
const Version = 5

const hostModuleName = "./rapier_wasm2d_bg.js"

// scratchIdx is the JS heap slot used as the borrowed Float32Array scratch buffer.
const scratchIdx = 1023

// Fake JS objects for Rapier's internal timers (globalThis.performance.now()).
// Timing only feeds profiling counters, never the simulation.
const (
	globalIdx      = 1024
	performanceIdx = 1025
)

const MaxBodies = 32

type BodyParams struct {
	HalfLength     float64 `json:"halfLength,omitempty"`
	HalfWidth      float64 `json:"halfWidth,omitempty"`
	BorderRadius   float64 `json:"borderRadius,omitempty"`
	AngularDamping float64 `json:"angularDamping,omitempty"`
	Radius         float64 `json:"radius"`
	Density        float64 `json:"density"`
	LinearDamping  float64 `json:"linearDamping"`
	Restitution    float64 `json:"restitution"`
}

type Arena struct {
	HalfWidth       float64 `json:"halfWidth"`
	HalfHeight      float64 `json:"halfHeight"`
	GoalHalfWidth   float64 `json:"goalHalfWidth"`
	GoalDepth       float64 `json:"goalDepth"`
	WallRestitution float64 `json:"wallRestitution"`
	StopSpeed       float64 `json:"stopSpeed"`
	CornerChamfer   float64 `json:"cornerChamfer"`
}

// Config mirrors packages/config/data/physics.json.
type Config struct {
	Arena           Arena      `json:"arena"`
	Disc            BodyParams `json:"disc"`
	Ball            BodyParams `json:"ball"`
	MaxStepsPerShot int        `json:"maxStepsPerShot"`
	MaxImpulse      float64    `json:"maxImpulse"`
	MinImpulse      float64    `json:"minImpulse"`
	BoundsMargin    float64    `json:"boundsMargin"`
}

type Body struct {
	Angle float32 `json:"angle"`
	Kind  string  `json:"kind"` // "disc" | "ball"
	X     float32 `json:"x"`
	Y     float32 `json:"y"`
}

type Impulse struct {
	BodyIndex int
	IX, IY    float32
}

type Result struct {
	Outcome string // settled | goal_left | goal_right | timeout | invalid
	Ticks   int
	Bodies  []Body
	Hash    string
}

// Engine holds the compiled module; create one per process.
type Engine struct {
	cache       wazero.CompilationCache
	config      Config
	interpreter bool
}

// NewEngine uses wazero's interpreter. Its compiler mode generates native code
// that crashes when wazero runs inside a Go plugin (verified in Nakama 3.41.0:
// SIGSEGV jumping to 0x100000000), so the plugin must never use it. Both modes
// produce identical results; the interpreter is only slower.
func NewEngine(config Config) *Engine {
	return &Engine{cache: wazero.NewCompilationCache(), config: config, interpreter: true}
}

// NewCompilerEngine is for tools and benchmarks outside Nakama only.
func NewCompilerEngine(config Config) *Engine {
	return &Engine{cache: wazero.NewCompilationCache(), config: config}
}

func (e *Engine) Close(ctx context.Context) error { return e.cache.Close(ctx) }

// WithConfig returns an engine for other physics that shares the compilation cache.
func (e *Engine) WithConfig(config Config) *Engine {
	c := *e
	c.config = config
	return &c
}

// Sim is one isolated wasm instance. Not safe for concurrent use; create one per match.
type Sim struct {
	rt     wazero.Runtime
	mod    api.Module
	fns    map[string]api.Function
	heap   *jsHeap
	config Config
	ctx    context.Context
}

func (e *Engine) NewSim(ctx context.Context) (*Sim, error) {
	cfg := wazero.NewRuntimeConfig()
	if e.interpreter {
		cfg = wazero.NewRuntimeConfigInterpreter()
	}
	rt := wazero.NewRuntimeWithConfig(ctx, cfg.WithCompilationCache(e.cache))
	compiled, err := rt.CompileModule(ctx, rapierWasm)
	if err != nil {
		rt.Close(ctx)
		return nil, fmt.Errorf("compile rapier: %w", err)
	}
	heap := newJSHeap()
	if err := buildHostModule(ctx, rt, compiled, heap); err != nil {
		rt.Close(ctx)
		return nil, err
	}
	mod, err := rt.InstantiateModule(ctx, compiled, wazero.NewModuleConfig().WithName("rapier").WithStartFunctions())
	if err != nil {
		rt.Close(ctx)
		return nil, fmt.Errorf("instantiate rapier: %w", err)
	}
	heap.mem = mod.Memory()
	return &Sim{rt: rt, mod: mod, fns: map[string]api.Function{}, heap: heap, config: e.config, ctx: ctx}, nil
}

func (s *Sim) Close() error { return s.rt.Close(s.ctx) }

// ---------- wasm-bindgen host shims ----------

type jsHeap struct {
	mu      sync.Mutex
	objects map[uint32][]float64
	next    uint32
	mem     api.Memory
}

func newJSHeap() *jsHeap {
	return &jsHeap{objects: map[uint32][]float64{scratchIdx: make([]float64, 4)}, next: 1028}
}

func buildHostModule(ctx context.Context, rt wazero.Runtime, compiled wazero.CompiledModule, heap *jsHeap) error {
	b := rt.NewHostModuleBuilder(hostModuleName)
	for _, imp := range compiled.ImportedFunctions() {
		module, name, _ := imp.Import()
		if module != hostModuleName {
			return fmt.Errorf("unexpected import module %q", module)
		}
		fn := hostFunc(name, heap, imp.ParamTypes())
		b.NewFunctionBuilder().WithGoModuleFunction(fn, imp.ParamTypes(), imp.ResultTypes()).Export(name)
	}
	_, err := b.Instantiate(ctx)
	return err
}

func hostFunc(name string, heap *jsHeap, params []api.ValueType) api.GoModuleFunc {
	switch {
	case strings.HasPrefix(name, "__wbg_set_index_"):
		return func(_ context.Context, _ api.Module, stack []uint64) {
			heap.mu.Lock()
			defer heap.mu.Unlock()
			obj := heap.objects[api.DecodeU32(stack[0])]
			if i := int(api.DecodeU32(stack[1])); i < len(obj) {
				if params[2] == api.ValueTypeF32 {
					obj[i] = float64(api.DecodeF32(stack[2]))
				} else {
					obj[i] = api.DecodeF64(stack[2])
				}
			}
		}
	case strings.HasPrefix(name, "__wbg_new_with_length_"):
		return func(_ context.Context, _ api.Module, stack []uint64) {
			heap.mu.Lock()
			defer heap.mu.Unlock()
			idx := heap.next
			heap.next++
			heap.objects[idx] = make([]float64, api.DecodeU32(stack[0]))
			stack[0] = api.EncodeU32(idx)
		}
	case strings.HasPrefix(name, "__wbg_length_"):
		return func(_ context.Context, _ api.Module, stack []uint64) {
			heap.mu.Lock()
			defer heap.mu.Unlock()
			stack[0] = api.EncodeU32(uint32(len(heap.objects[api.DecodeU32(stack[0])])))
		}
	case name == "__wbindgen_object_drop_ref":
		return func(_ context.Context, _ api.Module, stack []uint64) {
			heap.mu.Lock()
			defer heap.mu.Unlock()
			if idx := api.DecodeU32(stack[0]); idx != scratchIdx && idx != globalIdx && idx != performanceIdx {
				delete(heap.objects, idx)
			}
		}
	case name == "__wbindgen_object_clone_ref":
		return func(_ context.Context, _ api.Module, stack []uint64) {}
	case strings.HasPrefix(name, "__wbg_static_accessor_"):
		return func(_ context.Context, _ api.Module, stack []uint64) { stack[0] = api.EncodeU32(globalIdx) }
	case strings.HasPrefix(name, "__wbg_performance_"):
		return func(_ context.Context, _ api.Module, stack []uint64) { stack[0] = api.EncodeU32(performanceIdx) }
	case strings.HasPrefix(name, "__wbg_now_"):
		return func(_ context.Context, _ api.Module, stack []uint64) { stack[0] = api.EncodeF64(0) }
	case strings.HasPrefix(name, "__wbg___wbindgen_is_undefined_"):
		return func(_ context.Context, _ api.Module, stack []uint64) {
			idx := api.DecodeU32(stack[0])
			heap.mu.Lock()
			_, known := heap.objects[idx]
			heap.mu.Unlock()
			if known || idx == globalIdx || idx == performanceIdx {
				stack[0] = 0
			} else {
				stack[0] = 1
			}
		}
	case strings.HasPrefix(name, "__wbg___wbindgen_is_function_"):
		return func(_ context.Context, _ api.Module, stack []uint64) { stack[0] = 0 }
	case strings.HasPrefix(name, "__wbg___wbindgen_throw_"):
		return func(_ context.Context, m api.Module, stack []uint64) {
			msg, _ := m.Memory().Read(api.DecodeU32(stack[0]), api.DecodeU32(stack[1]))
			panic("rapier: " + string(msg))
		}
	default:
		// Any other JS interop (callbacks, globals, timers) is not used by the
		// physics path; reaching it means the call sequence diverged from JS.
		return func(context.Context, api.Module, []uint64) {
			panic("rapier: unsupported JS import " + name)
		}
	}
}

// ---------- raw call helpers ----------

// handle is a Rapier body/collider handle carried as the raw bits of an f64.
type handle uint64

func (s *Sim) fn(name string) api.Function {
	f, ok := s.fns[name]
	if !ok {
		f = s.mod.ExportedFunction(name)
		if f == nil {
			panic("rapier: missing export " + name)
		}
		s.fns[name] = f
	}
	return f
}

// call encodes each argument by the export's declared parameter type, the
// same conversion JS performs (Number → f32 rounds to nearest-even).
func (s *Sim) call(name string, args ...any) uint64 {
	f := s.fn(name)
	types := f.Definition().ParamTypes()
	if len(types) != len(args) {
		panic(fmt.Sprintf("rapier: %s expects %d args, got %d", name, len(types), len(args)))
	}
	raw := make([]uint64, len(args))
	for i, a := range args {
		raw[i] = encode(types[i], a)
	}
	res, err := f.Call(s.ctx, raw...)
	if err != nil {
		panic(fmt.Errorf("rapier: %s: %w", name, err))
	}
	if len(res) == 0 {
		return 0
	}
	return res[0]
}

func encode(t api.ValueType, a any) uint64 {
	switch t {
	case api.ValueTypeI32:
		switch v := a.(type) {
		case bool:
			if v {
				return 1
			}
			return 0
		case int:
			return api.EncodeU32(uint32(v))
		case uint32:
			return api.EncodeU32(v)
		case uint64: // pointer returned by another call
			return api.EncodeU32(uint32(v))
		}
	case api.ValueTypeF32:
		switch v := a.(type) {
		case float64:
			return api.EncodeF32(float32(v))
		case float32:
			return api.EncodeF32(v)
		case int:
			return api.EncodeF32(float32(v))
		}
	case api.ValueTypeF64:
		switch v := a.(type) {
		case handle:
			return uint64(v)
		case float64:
			return api.EncodeF64(v)
		case float32:
			return api.EncodeF64(float64(v))
		case int:
			return api.EncodeF64(float64(v))
		}
	}
	panic(fmt.Sprintf("rapier: cannot encode %T as %v", a, t))
}

func (s *Sim) vec(x, y float32) uint64 { return s.call("rawvector_new", x, y) }

func (s *Sim) free(kind string, ptr uint64) { s.call("__wbg_raw"+kind+"_free", ptr, 0) }

func (s *Sim) scratch() (float32, float32) {
	s.heap.mu.Lock()
	defer s.heap.mu.Unlock()
	buf := s.heap.objects[scratchIdx]
	return float32(buf[0]), float32(buf[1])
}

// ---------- world ----------

type world struct {
	params, islands, broad, narrow, bodies, colliders, joints, multibody, soft, ccd, pipeline uint64
}

func (s *Sim) newWorld() world {
	w := world{
		params:    s.call("rawintegrationparameters_new"),
		islands:   s.call("rawislandmanager_new"),
		broad:     s.call("rawbroadphase_new"),
		narrow:    s.call("rawnarrowphase_new"),
		bodies:    s.call("rawrigidbodyset_new"),
		colliders: s.call("rawcolliderset_new"),
		joints:    s.call("rawimpulsejointset_new"),
		multibody: s.call("rawmultibodyjointset_new"),
		soft:      s.call("rawsoftbodyset_new"),
		ccd:       s.call("rawccdsolver_new"),
		pipeline:  s.call("rawphysicspipeline_new"),
	}
	s.call("rawintegrationparameters_set_maxCcdSubsteps", w.params, 4)
	s.call("rawintegrationparameters_set_contact_natural_frequency", w.params, float32(120))
	return w
}

func (s *Sim) freeWorld(w world) {
	s.free("integrationparameters", w.params)
	s.free("islandmanager", w.islands)
	s.free("broadphase", w.broad)
	s.free("narrowphase", w.narrow)
	s.free("rigidbodyset", w.bodies)
	s.free("colliderset", w.colliders)
	s.free("impulsejointset", w.joints)
	s.free("multibodyjointset", w.multibody)
	s.free("softbodyset", w.soft)
	s.free("ccdsolver", w.ccd)
	s.free("physicspipeline", w.pipeline)
}

// createRigidBody mirrors RigidBodyDesc → RawRigidBodySet.createRigidBody.
func (s *Sim) createRigidBody(w world, x, y float32, dynamic bool, linearDamping float64, ccd bool, angle float32, angularDamping float64, lockRotation bool) handle {
	tr := s.vec(x, y)
	rot := s.call("rawrotation_fromAngle", angle)
	linvel := s.vec(0, 0)
	com := s.vec(0, 0)
	rbType, canSleep, rotationsEnabled := 1, true, true
	if dynamic {
		rbType, canSleep, rotationsEnabled = 0, false, !lockRotation
	}
	softCcd := float32(0)
	if dynamic {
		softCcd = 0.6
	}
	h := s.call("rawrigidbodyset_createRigidBody", w.bodies, true, tr, rot,
		float32(1), float32(0), false, com, linvel, float32(0), float32(0),
		true, true, rotationsEnabled, linearDamping, angularDamping, rbType,
		canSleep, false, softCcd, ccd, 0, 0, 0)
	s.free("vector", tr)
	s.free("rotation", rot)
	s.free("vector", linvel)
	s.free("vector", com)
	return handle(h)
}

// createCollider mirrors ColliderDesc defaults → RawColliderSet.createCollider.
func (s *Sim) createCollider(w world, shape uint64, density, restitution float64, parent handle) {
	tr := s.vec(0, 0)
	rot := s.call("rawrotation_fromAngle", float32(0))
	com := s.vec(0, 0)
	retptr := s.call("__wbindgen_add_to_stack_pointer", -16)
	s.call("rawcolliderset_createCollider", retptr, w.colliders, true, shape, tr, rot,
		0, float32(0), com, float32(0), density, float32(0), restitution, 0, 0, false,
		uint32(0xffffffff), uint32(0xffffffff), 15, 0, 0, float32(0), float32(0), true, parent, w.bodies)
	s.call("__wbindgen_add_to_stack_pointer", 16)
	s.free("shape", shape)
	s.free("vector", tr)
	s.free("rotation", rot)
	s.free("vector", com)
}

// SimulateShot is the Go twin of FlickSim.simulateShot in packages/sim.
func (s *Sim) SimulateShot(bodies []Body, imp Impulse, maxSteps int) (res Result, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("%v", r)
		}
	}()
	n := len(bodies)
	if n == 0 || n > MaxBodies {
		return Result{}, fmt.Errorf("invalid body count %d", n)
	}
	if imp.BodyIndex < 0 || imp.BodyIndex >= n {
		return Result{}, fmt.Errorf("invalid body index %d", imp.BodyIndex)
	}
	if maxSteps <= 0 {
		maxSteps = s.config.MaxStepsPerShot
	}
	if !s.sane(bodies) || !finite32(imp.IX) || !finite32(imp.IY) {
		out := append([]Body(nil), bodies...)
		return Result{Outcome: "invalid", Bodies: out, Hash: HashBodies(out)}, nil
	}
	a := s.config.Arena
	w := s.newWorld()
	defer func() {
		// Best effort: after a trap Rust may still hold borrows; the instance is
		// then discarded by the caller, so a failed free must not mask the error.
		defer func() { _ = recover() }()
		s.freeWorld(w)
	}()

	walls := s.createRigidBody(w, 0, 0, false, 0, false, 0, 0, false)
	for _, seg := range ArenaSegments(s.config) {
		v1 := s.vec(float32(seg[0]), float32(seg[1]))
		v2 := s.vec(float32(seg[2]), float32(seg[3]))
		shape := s.call("rawshape_segment", v1, v2)
		s.free("vector", v1)
		s.free("vector", v2)
		s.createCollider(w, shape, 1, a.WallRestitution, walls)
	}
	handles := make([]handle, n)
	ballIndex := -1
	for i, b := range bodies {
		p := s.config.Disc
		if b.Kind == "ball" {
			p = s.config.Ball
			ballIndex = i
		}
		angle := b.Angle
		if b.Kind == "disc" && i == imp.BodyIndex && (imp.IX != 0 || imp.IY != 0) {
			angle = float32(math.Atan2(float64(imp.IY), float64(imp.IX)))
		}
		handles[i] = s.createRigidBody(w, b.X, b.Y, true, p.LinearDamping, true, angle, p.AngularDamping, b.Kind == "ball")
		var shape uint64
		if b.Kind == "disc" && p.HalfLength > 0 && p.HalfWidth > 0 {
			shape = s.call("rawshape_roundCuboid", p.HalfLength-p.BorderRadius, p.HalfWidth-p.BorderRadius, p.BorderRadius)
		} else {
			shape = s.call("rawshape_ball", p.Radius)
		}
		s.createCollider(w, shape, p.Density, p.Restitution, handles[i])
	}
	iv := s.vec(imp.IX, imp.IY)
	s.call("rawrigidbodyset_rbApplyImpulse", w.bodies, handles[imp.BodyIndex], iv, true)
	s.free("vector", iv)

	positions := make([]float32, n*2)
	read := func(kind string, h handle) (float32, float32) {
		s.call("rawrigidbodyset_rb"+kind, w.bodies, h, scratchIdx)
		return s.scratch()
	}
	stop2 := a.StopSpeed * a.StopSpeed
	outcome, ticks := "timeout", 0
loop:
	for step := 0; step < maxSteps; step++ {
		g := s.vec(0, 0)
		s.call("rawphysicspipeline_step", w.pipeline, g, w.params, w.islands, w.broad, w.narrow,
			w.bodies, w.colliders, w.soft, w.joints, w.multibody, w.ccd)
		s.free("vector", g)
		ticks = step + 1
		for i, h := range handles {
			positions[i*2], positions[i*2+1] = read("Translation", h)
		}
		if ballIndex >= 0 {
			bx, by := float64(positions[ballIndex*2]), float64(positions[ballIndex*2+1])
			if by < a.GoalHalfWidth && by > -a.GoalHalfWidth {
				if bx < -a.HalfWidth {
					outcome = "goal_left"
					break loop
				}
				if bx > a.HalfWidth {
					outcome = "goal_right"
					break loop
				}
			}
		}
		moving := false
		for _, h := range handles {
			vx, vy := read("Linvel", h)
			spin := api.DecodeF32(s.call("rawrigidbodyset_rbAngvel", w.bodies, h))
			speed2 := float64(vx)*float64(vx) + float64(vy)*float64(vy)
			if speed2 < stop2 {
				if speed2 > 0 {
					z := s.vec(0, 0)
					s.call("rawrigidbodyset_rbSetLinvel", w.bodies, h, z, true)
					s.free("vector", z)
				}
			} else {
				moving = true
			}
			if math.Abs(float64(spin)) < a.StopSpeed {
				if spin != 0 {
					s.call("rawrigidbodyset_rbSetAngvel", w.bodies, h, float32(0), true)
				}
			} else {
				moving = true
			}
		}
		if !moving {
			outcome = "settled"
			break
		}
	}

	final := make([]Body, n)
	for i, b := range bodies {
		final[i] = Body{Kind: b.Kind, X: positions[i*2], Y: positions[i*2+1], Angle: api.DecodeF32(s.call("rawrigidbodyset_rbRotation", w.bodies, handles[i]))}
	}
	if !s.sane(final) {
		outcome = "invalid"
	}
	return Result{Outcome: outcome, Ticks: ticks, Bodies: final, Hash: HashBodies(final)}, nil
}

func finite32(v float32) bool { return !math.IsNaN(float64(v)) && !math.IsInf(float64(v), 0) }

func (s *Sim) sane(bodies []Body) bool {
	a := s.config.Arena
	limitX := a.HalfWidth + a.GoalDepth + s.config.BoundsMargin
	limitY := a.HalfHeight + s.config.BoundsMargin
	for _, b := range bodies {
		if !finite32(b.X) || !finite32(b.Y) || !finite32(b.Angle) || math.Abs(float64(b.X)) > limitX || math.Abs(float64(b.Y)) > limitY {
			return false
		}
	}
	return true
}

// ArenaSegments mirrors arenaSegments in packages/sim.
func ArenaSegments(c Config) [][4]float64 {
	w, h, g, d, k := c.Arena.HalfWidth, c.Arena.HalfHeight, c.Arena.GoalHalfWidth, c.Arena.GoalDepth, c.Arena.CornerChamfer
	return [][4]float64{
		{-w + k, h, w - k, h}, {-w + k, -h, w - k, -h},
		{-w, h - k, -w + k, h}, {w - k, h, w, h - k}, {-w, -h + k, -w + k, -h}, {w - k, -h, w, -h + k},
		{-w, h - k, -w, g}, {-w, -g, -w, -h + k}, {-w, g, -w - d, g}, {-w - d, g, -w - d, -g}, {-w - d, -g, -w, -g},
		{w, h - k, w, g}, {w, -g, w, -h + k}, {w, g, w + d, g}, {w + d, g, w + d, -g}, {w + d, -g, w, -g},
	}
}

// HashBodies mirrors hashBodies in packages/sim: FNV-1a over kind byte + f32 bits (LE).
func HashBodies(bodies []Body) string {
	h := fnv.New32a()
	buf := make([]byte, 4)
	for _, b := range bodies {
		if b.Kind == "ball" {
			h.Write([]byte{1})
		} else {
			h.Write([]byte{0})
		}
		for _, v := range []float32{b.X, b.Y, b.Angle} {
			bits := math.Float32bits(v)
			buf[0], buf[1], buf[2], buf[3] = byte(bits), byte(bits>>8), byte(bits>>16), byte(bits>>24)
			h.Write(buf)
		}
	}
	return fmt.Sprintf("%08x", h.Sum32())
}

var ErrInvalid = errors.New("invalid simulation")
