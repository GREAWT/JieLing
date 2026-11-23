const SPIKE_ROOT = '__spike__';

async function opfsRoot() {
  return navigator.storage.getDirectory();
}

async function spikeRoot() {
  const root = await opfsRoot();
  return root.getDirectoryHandle(SPIKE_ROOT, { create: true });
}

async function writeText(dir, name, text) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
  return fh;
}

window.spikeCleanup = async () => {
  const root = await opfsRoot();
  try {
    await root.removeEntry(SPIKE_ROOT, { recursive: true });
    return { cleaned: true };
  } catch (e) {
    return { cleaned: false, error: String(e) };
  }
};

window.spikeApis = () => ({
  ua: navigator.userAgent,
  isSecureContext: window.isSecureContext,
  origin: location.origin,
  showDirectoryPicker: typeof window.showDirectoryPicker,
  showOpenFilePicker: typeof window.showOpenFilePicker,
  storageGetDirectory: typeof navigator.storage?.getDirectory,
  FileSystemHandle: typeof window.FileSystemHandle,
  handleMove: typeof window.FileSystemHandle?.prototype?.move,
  handleRemove: typeof window.FileSystemHandle?.prototype?.remove,
  dirRemoveEntry: typeof window.FileSystemDirectoryHandle?.prototype?.removeEntry,
  dirResolve: typeof window.FileSystemDirectoryHandle?.prototype?.resolve,
  dirEntries: typeof window.FileSystemDirectoryHandle?.prototype?.entries,
  fileCreateWritable: typeof window.FileSystemFileHandle?.prototype?.createWritable,
  fileGetFile: typeof window.FileSystemFileHandle?.prototype?.getFile,
  Worker: typeof window.Worker,
  queryPermission: typeof window.FileSystemHandle?.prototype?.queryPermission,
  requestPermission: typeof window.FileSystemHandle?.prototype?.requestPermission,
});

window.spikeOpfs = async () => {
  const results = [];
  const rec = (step, ok, detail) => results.push({ step, ok, detail });
  await window.spikeCleanup();

  let base;
  try {
    base = await spikeRoot();
    rec('getDirectoryHandle(create)', true, 'ok');
  } catch (e) {
    rec('getDirectoryHandle(create)', false, String(e));
    return results;
  }

  let a, b;
  try {
    a = await base.getDirectoryHandle('a', { create: true });
    b = await a.getDirectoryHandle('b', { create: true });
    rec('nested mkdir', true, 'a/b');
  } catch (e) {
    rec('nested mkdir', false, String(e));
  }

  let fh;
  try {
    fh = await writeText(a, 'hello.txt', 'hello-opfs');
    const back = await (await fh.getFile()).text();
    rec('write+read', back === 'hello-opfs', back);
  } catch (e) {
    rec('write+read', false, String(e));
  }

  try {
    const before = typeof fh.move;
    const r = await fh.move('renamed.txt');
    const names = [];
    for await (const n of a.keys()) names.push(n);
    rec('move(rename in same dir)', names.includes('renamed.txt') && !names.includes('hello.txt'), {
      methodType: before,
      returnValue: r === undefined ? 'undefined' : typeof r,
      names,
    });
  } catch (e) {
    rec('move(rename in same dir)', false, String(e));
  }

  try {
    const h = await a.getFileHandle('renamed.txt');
    await h.move(b, 'moved.txt');
    const names = [];
    for await (const n of b.keys()) names.push(n);
    rec('move(cross dir)', names.includes('moved.txt'), names);
  } catch (e) {
    rec('move(cross dir)', false, String(e));
  }

  try {
    await b.move(a, 'renamedDir');
    const names = [];
    for await (const n of a.keys()) names.push(n);
    rec('move(directory)', names.includes('renamedDir'), names);
  } catch (e) {
    rec('move(directory)', false, String(e));
  }

  try {
    const target = await a.getFileHandle('renamedDir/moved.txt').catch(() => null);
    const rd = await a.getDirectoryHandle('renamedDir');
    const mh = await rd.getFileHandle('moved.txt');
    const p = await base.resolve(mh);
    rec('resolve(path)', Array.isArray(p), p);
  } catch (e) {
    rec('resolve(path)', false, String(e));
  }

  try {
    await a.removeEntry('renamedDir');
    rec('removeEntry(non-empty, no recursive) should FAIL', false, 'unexpectedly succeeded');
  } catch (e) {
    rec('removeEntry(non-empty, no recursive) should FAIL', true, e.name);
  }

  try {
    await a.removeEntry('renamedDir', { recursive: true });
    const names = [];
    for await (const n of a.keys()) names.push(n);
    rec('removeEntry(recursive)', !names.includes('renamedDir'), names);
  } catch (e) {
    rec('removeEntry(recursive)', false, String(e));
  }

  try {
    await a.getFileHandle('does-not-exist.txt');
    rec('getFileHandle(missing) should FAIL', false, 'unexpectedly succeeded');
  } catch (e) {
    rec('getFileHandle(missing) should FAIL', true, e.name);
  }

  try {
    await fh.remove();
    rec('handle.remove() on stale handle', true, 'no throw');
  } catch (e) {
    rec('handle.remove() on stale handle', false, e.name);
  }

  await window.spikeCleanup();
  return results;
};

window.spikePerf = async (dirCount = 40, filesPerDir = 50) => {
  await window.spikeCleanup();
  const base = await spikeRoot();
  const payload = 'x'.repeat(256);

  const t0 = performance.now();
  for (let d = 0; d < dirCount; d++) {
    const dir = await base.getDirectoryHandle(`d${d}`, { create: true });
    for (let f = 0; f < filesPerDir; f++) {
      await writeText(dir, `f${f}.bin`, payload);
    }
  }
  const createMs = performance.now() - t0;

  const t1 = performance.now();
  let nameOnlyCount = 0;
  async function walkNames(dir) {
    for await (const [, h] of dir.entries()) {
      nameOnlyCount++;
      if (h.kind === 'directory') await walkNames(h);
    }
  }
  await walkNames(base);
  const namesMs = performance.now() - t1;

  const t2 = performance.now();
  let statCount = 0;
  let bytes = 0;
  async function walkStat(dir) {
    for await (const [, h] of dir.entries()) {
      if (h.kind === 'directory') {
        await walkStat(h);
      } else {
        const file = await h.getFile();
        bytes += file.size;
        statCount++;
      }
    }
  }
  await walkStat(base);
  const statMs = performance.now() - t2;

  const t3 = performance.now();
  await base.removeEntry(`d0`, { recursive: true });
  const removeOneDirMs = performance.now() - t3;

  await window.spikeCleanup();
  return {
    files: dirCount * filesPerDir,
    dirs: dirCount,
    createMs: Math.round(createMs),
    namesOnly: { count: nameOnlyCount, ms: Math.round(namesMs) },
    withGetFile: { count: statCount, bytes, ms: Math.round(statMs) },
    removeOneDirMs: Math.round(removeOneDirMs),
  };
};