// How much flair each player shows on the ball: how often he takes a chance for a skill move (sim.js), which moves he
// can do and his favourites (picked four times as often). Every player can do the simple moves; stars known for
// their dribbling try one more often and do more; a made-up player (a name we do not know) tries fewer.
// Moves: stepover, scissors (double stepover), feint (body feint, dropped shoulder), croqueta (inside of one foot
// across to the inside of the other), double (two quick touches across him: the inside of one foot, the outside of
// the other), chop (fake shot, inside chop), cruyff (fake pass, drag behind the standing
// leg), roll (the sole rolls it across his body). No imports, so the sim and the picture can both read it.
const SIMPLE = ['stepover', 'scissors', 'feint', 'double', 'chop', 'cruyff'], MORE = [...SIMPLE, 'croqueta', 'roll'], ALL = MORE;
// How often each move comes up against the others it could be (before a player's favourites count four times): the
// clear, easy-to-see ones most; the chop, which every cut could be, less.
export const MOVE_W = { stepover: 2.2, scissors: 2, feint: 1, double: 1.2, chop: .3, cruyff: 1, croqueta: 1, roll: .5 };
const STARS = { 'VINI JR': 'scissors stepover', YAMAL: 'feint croqueta chop', 'MBAPPÉ': 'stepover scissors', MESSI: 'feint croqueta chop', RONALDO: 'scissors stepover',
  MUSIALA: 'roll croqueta', 'LEÃO': 'stepover chop', 'NICO WILLIAMS': 'stepover feint', DOKU: 'feint stepover', 'DEMBÉLÉ': 'stepover chop' };
const SKILLED = { SAKA: 'chop', OLISE: 'roll', KUBO: 'chop', MITOMA: 'feint', PEDRI: 'croqueta', 'ØDEGAARD': 'roll', 'MODRIĆ': 'roll', RAPHINHA: 'stepover', SALAH: 'chop',
  'GÜLER': 'chop', WIRTZ: 'croqueta', PALMER: 'cruyff', YILDIZ: 'stepover', ARRASCAETA: 'roll', LOOKMAN: 'stepover', 'DÍAZ': 'feint', BRAHIM: 'croqueta', MALCOM: 'stepover',
  JAMES: 'cruyff', FODEN: 'croqueta', BELLINGHAM: 'cruyff', SON: 'stepover', 'DE BRUYNE': 'cruyff' };
// Every other real player in js/teams.js plays it simpler. (Kept short: any name not listed counts as made up.)
const REAL = new Set(('ADAMS,ADEYEMI,AKANJI,ARAÚJO,AURSNES,BARELLA,BRANDT,BRUNO,CAICEDO,CONCEIÇÃO,DAVID,DAVIES,DE JONG,DE PAUL,DONNARUMMA,EDSON,' +
  'EN-NESYRI,ENDO,ENZO,ERIKSEN,EUSTÁQUIO,FÉLIX,GAKPO,GIMÉNEZ,GORDON,GRIEZMANN,GRIMALDO,GUIMARÃES,GUIRASSY,GVARDIOL,HAALAND,HAKIMI,HAVERTZ,HINCAPIÉ,' +
  'HJULMAND,HØJLUND,IÑAKI WILLIAMS,JACKSON,JIMÉNEZ,JORGINHO,KANE,KIM,KOKE,KOULIBALY,KOVAČIĆ,LAUTARO,LEE,LERMA,LEWANDOWSKI,LUKAKU,MAC ALLISTER,' +
  'MADDISON,MAINOO,MANÉ,MARMOUSH,MARQUINHOS,MBEUMO,MCGINN,MCKENNIE,MCTOMINAY,NDIDI,NDOYE,NEVES,NÚÑEZ,OSIMHEN,OTAMENDI,PAVLIDIS,PEDRO,PEPÊ,PULISIC,' +
  'RICE,RODRI,ROGERS,SAMU,SANCET,SCHICK,SOLANKE,SUÁREZ,SØRLOTH,TAPSOBA,TCHOUAMÉNI,THEO,THURAM,TONALI,TREZEGUET,VALENCIA,VALVERDE,VAN DE VEN,VAN DIJK,' +
  'VARELA,VITINHA,VLAHOVIĆ,WATKINS,XHAKA,ÁLVAREZ,ÇALHANOĞLU').split(','));
// p: the chance he takes a skill when one makes sense; can: the moves he does; fav: his favourites; tier: for the counts.
export function flairOf(name = '') {
  if (STARS[name]) return { p: .85, can: ALL, fav: STARS[name].split(' '), tier: 'star' };
  if (SKILLED[name]) return { p: .65, can: MORE, fav: SKILLED[name].split(' '), tier: 'skilled' };
  if (REAL.has(name)) return { p: .6, can: SIMPLE, fav: [], tier: 'plain' };
  return { p: .45, can: SIMPLE, fav: [], tier: 'made-up' };
}
