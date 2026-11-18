/** Only the dedicated local development server enables the screen browser. */
export const screenPreview = import.meta.env.DEV && import.meta.env.MODE === 'screens';
