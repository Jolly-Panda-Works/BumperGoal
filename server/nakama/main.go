// FlickKick Nakama Go runtime plugin.
package main

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/heroiclabs/nakama-common/runtime"

	"flickkick/server/sim"
)

// ServerVersion is reported by the healthcheck RPC.
const ServerVersion = "0.3.0"

//nolint:deadcode // Nakama looks the symbol up by name.
func InitModule(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, initializer runtime.Initializer) error {
	if err := loadLiveConfig(ctx, logger, nk); err != nil {
		return err
	}
	loadLanguages(ctx, logger, nk)
	if err := initLeaderboards(ctx, nk); err != nil {
		return fmt.Errorf("initialise leaderboards: %w", err)
	}
	if env, ok := ctx.Value(runtime.RUNTIME_CTX_ENV).(map[string]string); ok {
		configureMatchmaking(env)
		configureAdmin(env, logger)
		configureVoice(env, logger)
	}

	for name, fn := range map[string]func(context.Context, runtime.Logger, *sql.DB, runtime.NakamaModule, string) (string, error){
		"healthcheck":           rpcHealthcheck,
		"profile_get":           rpcProfileGet,
		"player_lookup":         rpcPlayerLookup,
		"referral_apply":        rpcReferralApply,
		"leaderboard_list":      rpcLeaderboard,
		"profile_update":        rpcProfileUpdate,
		"friend_create":         rpcFriendCreate,
		"friend_join":           rpcFriendJoin,
		"friend_status":         rpcFriendStatus,
		"friend_cancel":         rpcFriendCancel,
		"mm_start":              rpcMatchmakingStart,
		"mm_cancel":             rpcMatchmakingCancel,
		"mm_preview":            rpcMatchmakingPreview,
		"mm_status":             rpcMatchmakingStatus,
		"trail_purchase":        rpcTrailPurchase,
		"formation_purchase":    rpcFormationPurchase,
		"item_purchase":         rpcItemPurchase,
		"pack_claim":            rpcPackClaim,
		"daily_claim":           rpcDailyClaim,
		"history_get":           rpcHistoryGet,
		"history_list":          rpcHistoryList,
		"config_get":            rpcConfigGet,
		"admin_login":           rpcAdminLogin,
		"admin_config_get":      rpcAdminConfigGet,
		"admin_config_set":      rpcAdminConfigSet,
		"admin_languages_get":   rpcAdminLanguagesGet,
		"admin_language_set":    rpcAdminLanguageSet,
		"admin_language_delete": rpcAdminLanguageDelete,
		"languages_get":         rpcLanguagesGet,
		"admin_asset_put":       rpcAdminAssetPut,
		"asset_get":             rpcAssetGet,
		"voice_token":           rpcVoiceToken,
		"voice_webhook":         rpcVoiceWebhook,
		"admin_voice_reports":   rpcAdminVoiceReports,
	} {
		if err := initializer.RegisterRpc(name, fn); err != nil {
			return fmt.Errorf("register rpc %s: %w", name, err)
		}
	}
	if err := initializer.RegisterMatch(matchModule, newMatch); err != nil {
		return err
	}
	if err := initializer.RegisterMatchmakerOverride(matchmakerOverride); err != nil {
		return err
	}
	if err := initializer.RegisterMatchmakerMatched(matchmakerMatched); err != nil {
		return err
	}
	if err := initializer.RegisterAfterAuthenticateDevice(afterAuthenticateDevice); err != nil {
		return err
	}
	if err := initializer.RegisterAfterAuthenticateEmail(afterAuthenticateEmail); err != nil {
		return err
	}

	logger.WithFields(map[string]any{
		"version":     ServerVersion,
		"sim_version": sim.Version,
		"rapier_wasm": sim.RapierWasmSHA256[:12],
		"bot_timeout": botTimeout.String(),
	}).Info("FlickKick module loaded")
	return nil
}
