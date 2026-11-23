// Durable cross-instance coordinator for Cloud resource creation.
// Atomic claim uses insertIfAbsent on the primary key; takeover and every write
// are fenced by the row version, so a stale holder can never overwrite its
// successor. A process-local Map would not survive cold starts or parallel instances.

const LEASE_MS = 60_000;

export function createCoordinator({ db, BackendError }) {
  const pending = () => new BackendError('ai_initialization_pending', 202);
  const rows = (result) => {
    if (result.error) throw new BackendError(result.error.code, result.error.status);
    return result.data;
  };

  async function readRow(key) {
    const found = rows(await db.from('cloud_lease')
      .select('lock_key,record,holder,expires_at_ms,version')
      .eq('lock_key', key).limit(1));
    return found?.length ? found[0] : null;
  }

  function parseRecord(row) {
    if (!row?.record) return null;
    try {
      const value = JSON.parse(row.record);
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  }

  return {
    async withLock(key, callback) {
      if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(key)) {
        throw new BackendError('ai_configuration_invalid', 503);
      }
      const token = crypto.randomUUID();
      const expiry = Date.now() + LEASE_MS;
      let version;

      const claimed = rows(await db.from('cloud_lease')
        .insertIfAbsent(
          { lock_key: key, holder: token, expires_at_ms: expiry, version: 1, record: null },
          { onConflict: 'lock_key' },
        ).select('version'));

      if (claimed?.length) {
        version = Number(claimed[0].version);
      } else {
        const row = await readRow(key);
        if (!row) throw pending();
        // A live holder means another instance is mid-creation. Do not spin-wait
        // inside the request budget; the caller reports pending and reconciles later.
        if (Number(row.expires_at_ms) > Date.now()) throw pending();
        const taken = rows(await db.from('cloud_lease')
          .update({ holder: token, expires_at_ms: expiry, version: Number(row.version) + 1 })
          .eq('lock_key', key).eq('version', Number(row.version)).select('version'));
        if (!taken?.length) throw pending();
        version = Number(taken[0].version);
      }

      const held = (row) => row !== null
        && row.holder === token
        && Number(row.version) === version
        && Number(row.expires_at_ms) > Date.now();

      const lease = {
        async read() {
          const row = await readRow(key);
          if (!held(row)) throw pending();
          return parseRecord(row);
        },
        async assertHeld() {
          if (!held(await readRow(key))) throw pending();
        },
        async write(partial) {
          const row = await readRow(key);
          if (!held(row)) throw pending();
          const merged = { ...(parseRecord(row) ?? {}), ...partial };
          const updated = rows(await db.from('cloud_lease')
            .update({
              record: JSON.stringify(merged),
              version: version + 1,
              expires_at_ms: Date.now() + LEASE_MS,
            })
            .eq('lock_key', key).eq('holder', token).eq('version', version)
            .select('version'));
          if (!updated?.length) throw pending();
          version = Number(updated[0].version);
        },
      };

      return await callback(lease);
    },
  };
}