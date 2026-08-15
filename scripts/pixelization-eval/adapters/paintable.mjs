import { runStylePreset } from './stylePreset.mjs';

export const id = 'paintable';
export const run = (context) => runStylePreset(context, 'paintable');
export default { id, run };
