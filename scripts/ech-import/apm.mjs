// APM extras for the ECH data file (D40): the APM Server size ladders (Specs!U1168:X1858, Specs!AC1168:AF1858),
// the events/s each GB serves (Specs!B1164), the instance types that use the second ladder (APM!K148) and the
// APM sheet's own instance selections (APM!E24:E34), which are its defaults for that sheet's provider.
export async function extract({ sheet, val, num, str }) {
  const specs = sheet('Specs');
  const ladder = (col) => {
    const out = [];
    for (let r = 1168; r <= 1858; r++) {
      const gb = num(val(specs, `${col}${r}`));
      if (gb !== undefined) out.push(gb);
    }
    return out;
  };
  const apm = sheet('APM');
  const k148 = apm.getCell('K148').formula ?? '';
  const secondLadderSkus = [...k148.matchAll(/K124="([^"]+)"/g)].map((m) => m[1]);
  const provider = str(val(apm, 'E5'))?.toLowerCase();
  const roles = [['E24', 'hot'], ['E25', 'warm'], ['E26', 'cold'], ['E27', 'frozen'], ['E29', 'apm'], ['E31', 'master'], ['E32', 'coordinating'], ['E33', 'ml'], ['E34', 'kibana']];
  const own = {};
  for (const [addr, role] of roles) {
    const id = str(val(apm, addr));
    if (id) own[role] = id;
  }
  // Logs!E29 is the AWS APM Server selection; the main defaults do not carry an APM role.
  const logsApm = str(val(sheet('Logs'), 'E29'));
  const defaults = { ...(provider ? { [provider]: own } : {}) };
  if (logsApm) defaults.aws = { ...(defaults.aws ?? {}), apm: defaults.aws?.apm ?? logsApm };
  return {
    eventsPerSecPerGb: num(val(specs, 'B1164')),
    ladder: ladder('X'),
    secondLadder: ladder('AF'),
    secondLadderSkus,
    defaults,
  };
}
