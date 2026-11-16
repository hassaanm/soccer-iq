// The saved progress and settings: loaded once, shared by every screen.
import { load, save as write, catchUp } from '../progress.js';
import { PATH } from '../skills.js';
import { setSize } from '../geom.js';
export const P = catchUp(load(), PATH); // lessons added since his last visit never close one he had open
setSize(P.settings.size); // (geom.js has set it from the save already, before the 3D world was built)
export const save = () => write(P);
