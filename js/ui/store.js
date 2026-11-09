// The saved progress and settings: loaded once, shared by every screen.
import { load, save as write } from '../progress.js';
export const P = load();
export const save = () => write(P);
