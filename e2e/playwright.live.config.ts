import { browserConfig } from './settings';

// npm run test:browser:live: one question to the real model. Run it on purpose; it uses the
// Gemini key's quota and its answer varies.
export default browserConfig(true);
