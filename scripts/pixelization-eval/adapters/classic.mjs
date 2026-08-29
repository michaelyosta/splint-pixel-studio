import { runStylePreset } from './stylePreset.mjs';

export const id = 'classic';
export const run = (context) => runStylePreset(context, 'classic');
export default { id, run };
