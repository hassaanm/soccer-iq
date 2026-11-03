// Teams the player can pick, sorted by name. Kits are "close enough" colors, never real logos.
// The first player on each team is the one the child controls.
const S = { light: '#f0c8a6', tan: '#d9a37a', mid: '#b07a52', brown: '#8a5a3a', dark: '#6b4429' };

export const TEAMS = [
  { id: 'argentina', name: 'Argentina', short: 'ARG',
    kit: { pattern: 'stripes', colors: ['#75aadb', '#ffffff'], shorts: '#1b1b1f', socks: '#ffffff', num: '#1b1b1f', trim: '#c9a227' },
    players: [{ name: 'MESSI', num: 10, skin: S.tan, hair: '#3a2a1c' }, { name: 'LAUTARO', num: 22, skin: S.tan, hair: '#1b1410' }, { name: 'MAC ALLISTER', num: 20, skin: S.light, hair: '#b9824a' }] },
  { id: 'arsenal', name: 'Arsenal', short: 'ARS',
    kit: { pattern: 'sleeves', colors: ['#ef0107', '#ffffff'], shorts: '#ffffff', socks: '#ffffff', num: '#ffffff', trim: '#ffffff' },
    players: [{ name: 'SAKA', num: 7, skin: S.dark, hair: '#120c08' }, { name: 'ØDEGAARD', num: 8, skin: S.light, hair: '#5a4330' }, { name: 'RICE', num: 41, skin: S.light, hair: '#3a2a1c' }] },
  { id: 'atleti', name: 'Atlético', short: 'ATM',
    kit: { pattern: 'stripes', colors: ['#cb3524', '#ffffff'], shorts: '#1c2c5b', socks: '#cb3524', num: '#1c2c5b', trim: '#1c2c5b' },
    players: [{ name: 'GRIEZMANN', num: 7, skin: S.light, hair: '#c9a46a' }, { name: 'ÁLVAREZ', num: 19, skin: S.tan, hair: '#1b1410' }, { name: 'KOKE', num: 6, skin: S.tan, hair: '#2a1c12' }] },
  { id: 'barca', name: 'Barça', short: 'BAR',
    kit: { pattern: 'stripes', colors: ['#a50044', '#004d98'], shorts: '#0b2a6b', socks: '#0b2a6b', num: '#f6c344', trim: '#f6c344' },
    players: [{ name: 'YAMAL', num: 19, skin: S.mid, hair: '#1b1410' }, { name: 'RAPHINHA', num: 11, skin: S.mid, hair: '#2a1c12' }, { name: 'LEWANDOWSKI', num: 9, skin: S.light, hair: '#5a4330' }] },
  { id: 'bayern', name: 'Bayern', short: 'BAY',
    kit: { pattern: 'solid', colors: ['#dc052d'], shorts: '#dc052d', socks: '#dc052d', num: '#ffffff', trim: '#ffffff' },
    players: [{ name: 'KANE', num: 9, skin: S.light, hair: '#6b4a2b' }, { name: 'MUSIALA', num: 10, skin: S.mid, hair: '#1b1410' }, { name: 'OLISE', num: 17, skin: S.dark, hair: '#120c08' }] },
  { id: 'england', name: 'England', short: 'ENG',
    kit: { pattern: 'solid', colors: ['#f6f6f4'], shorts: '#1b2a5a', socks: '#f6f6f4', num: '#1b2a5a', trim: '#c8102e' },
    players: [{ name: 'KANE', num: 9, skin: S.light, hair: '#6b4a2b' }, { name: 'BELLINGHAM', num: 10, skin: S.brown, hair: '#1a120c' }, { name: 'SAKA', num: 7, skin: S.dark, hair: '#120c08' }] },
  { id: 'germany', name: 'Germany', short: 'GER',
    kit: { pattern: 'solid', colors: ['#f6f6f4'], shorts: '#1b1b1f', socks: '#f6f6f4', num: '#1b1b1f', trim: '#1b1b1f' },
    players: [{ name: 'MUSIALA', num: 10, skin: S.mid, hair: '#1b1410' }, { name: 'WIRTZ', num: 17, skin: S.light, hair: '#5a4330' }, { name: 'HAVERTZ', num: 7, skin: S.light, hair: '#3a2a1c' }] },
  { id: 'liverpool', name: 'Liverpool', short: 'LIV',
    kit: { pattern: 'solid', colors: ['#c8102e'], shorts: '#c8102e', socks: '#c8102e', num: '#ffffff', trim: '#f6eb61' },
    players: [{ name: 'SALAH', num: 11, skin: S.mid, hair: '#1b1410' }, { name: 'WIRTZ', num: 7, skin: S.light, hair: '#5a4330' }, { name: 'VAN DIJK', num: 4, skin: S.brown, hair: '#120c08' }] },
  { id: 'city', name: 'Man City', short: 'MCI',
    kit: { pattern: 'solid', colors: ['#7cc0ea'], shorts: '#ffffff', socks: '#7cc0ea', num: '#14213d', trim: '#14213d' },
    players: [{ name: 'HAALAND', num: 9, skin: S.light, hair: '#d9b56a' }, { name: 'FODEN', num: 47, skin: S.light, hair: '#5a4330' }, { name: 'DOKU', num: 11, skin: S.dark, hair: '#120c08' }] },
  { id: 'united', name: 'Man United', short: 'MUN',
    kit: { pattern: 'solid', colors: ['#da291c'], shorts: '#ffffff', socks: '#1b1b1f', num: '#ffffff', trim: '#1b1b1f' },
    players: [{ name: 'BRUNO', num: 8, skin: S.tan, hair: '#2a1c12' }, { name: 'MBEUMO', num: 19, skin: S.dark, hair: '#120c08' }, { name: 'MAINOO', num: 37, skin: S.brown, hair: '#120c08' }] },
  { id: 'norway', name: 'Norway', short: 'NOR',
    kit: { pattern: 'solid', colors: ['#ba0c2f'], shorts: '#ffffff', socks: '#00205b', num: '#ffffff', trim: '#00205b' },
    players: [{ name: 'HAALAND', num: 9, skin: S.light, hair: '#d9b56a' }, { name: 'ØDEGAARD', num: 10, skin: S.light, hair: '#5a4330' }, { name: 'SØRLOTH', num: 7, skin: S.light, hair: '#6b4a2b' }] },
  { id: 'portugal', name: 'Portugal', short: 'POR',
    kit: { pattern: 'solid', colors: ['#a6192e'], shorts: '#00573f', socks: '#a6192e', num: '#f6c344', trim: '#00573f' },
    players: [{ name: 'RONALDO', num: 7, skin: S.tan, hair: '#1b1410' }, { name: 'BRUNO', num: 8, skin: S.tan, hair: '#2a1c12' }, { name: 'LEÃO', num: 17, skin: S.dark, hair: '#120c08' }] },
  { id: 'psg', name: 'PSG', short: 'PSG',
    kit: { pattern: 'band', colors: ['#0e1d40', '#d81e2c'], shorts: '#0e1d40', socks: '#0e1d40', num: '#ffffff', trim: '#d81e2c' },
    players: [{ name: 'DEMBÉLÉ', num: 10, skin: S.dark, hair: '#120c08' }, { name: 'HAKIMI', num: 2, skin: S.mid, hair: '#1b1410' }, { name: 'VITINHA', num: 17, skin: S.tan, hair: '#2a1c12' }] },
  { id: 'madrid', name: 'Real Madrid', short: 'RMA',
    kit: { pattern: 'solid', colors: ['#f4f4f2'], shorts: '#f4f4f2', socks: '#f4f4f2', num: '#22306b', trim: '#c9a227' },
    players: [{ name: 'MBAPPÉ', num: 10, skin: S.dark, hair: '#120c08' }, { name: 'VINI JR', num: 7, skin: S.dark, hair: '#120c08' }, { name: 'BELLINGHAM', num: 5, skin: S.brown, hair: '#1a120c' }] },
  { id: 'spain', name: 'Spain', short: 'ESP',
    kit: { pattern: 'solid', colors: ['#c60b1e'], shorts: '#1b2a5a', socks: '#1b2a5a', num: '#f6c344', trim: '#f6c344' },
    players: [{ name: 'YAMAL', num: 19, skin: S.mid, hair: '#1b1410' }, { name: 'PEDRI', num: 20, skin: S.tan, hair: '#2a1c12' }, { name: 'RODRI', num: 16, skin: S.tan, hair: '#3a2a1c' }] },
];

export const teamById = id => TEAMS.find(t => t.id === id) || TEAMS[0];

// Friendly display name, e.g. "LEWANDOWSKI" -> "Lewandowski".
export const displayName = n => n.split(' ').map(w => w[0] + w.slice(1).toLowerCase()).join(' ');
