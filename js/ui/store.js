// The saved progress and settings: loaded once, shared by every screen.
import { load, save as write, catchUp } from '../progress.js';
import { PATH } from '../skills.js';
export const P = catchUp(load(), PATH); // lessons added since his last visit never close one he had open
export const save = () => write(P);
