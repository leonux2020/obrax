/** usd = base DAILY rental in USD. `perSet` machines are priced per certified set (2 bays) per day. */
export const MACHINES = Object.freeze({
  mixer: { id: 'mixer', usd: 30 }, // trompo hormigonero
  compactor: { id: 'compactor', usd: 45 }, // placa compactadora
  scaffold: { id: 'scaffold', usd: 12, perSet: true }, // andamio certificado
});
export const MACHINE_IDS = Object.freeze(Object.keys(MACHINES));
