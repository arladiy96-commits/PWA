// The first history entry is the exit confirmation. Index 1 is the current
// main tab, and only its nested screens and layers get additional entries.
export function createNavigation({showExit, hideExit, exitDelay = 2500}) {
  const session = crypto.randomUUID();
  const entries = [null];
  const marker = index => ({pwaNavigation: session, index});
  let index = 0;
  let pending = false;
  let restoring = false;
  let rootChange = null;
  let returningFromForward = false;
  let exitTimer;
  const deferred = [];

  function clearExit() {
    if (exitTimer === undefined) return;
    clearTimeout(exitTimer);
    exitTimer = undefined;
    hideExit();
  }

  function armRoot() {
    clearExit();
    history.pushState(marker(1), '');
    index = 1;
  }

  function push(entry) {
    const page = document.querySelector('#page-scroll');
    entries[index].scroll = page?.scrollTop || 0;
    entries.splice(index + 1, entries.length, entry);
    history.pushState(marker(++index), '');
  }

  function screen(key, restore, {root = false} = {}) {
    if (restoring) return;
    if (pending) {
      deferred.push(() => screen(key, restore, {root}));
      return;
    }

    const entry = {key, restore};
    if (!entries[1]) {
      history.replaceState(marker(0), '');
      entries[1] = entry;
      armRoot();
    } else if (root) {
      if (index > 1) {
        rootChange = entry;
        pending = true;
        history.go(1 - index);
      } else {
        entries.splice(1, entries.length, entry);
        if (index === 0) armRoot();
      }
    } else {
      if (index === 0 && entries[1].key === key) {
        Object.assign(entries[1], entry);
        return;
      }
      if (index === 0) armRoot();
      if (entries[index].key === key) Object.assign(entries[index], entry);
      else if (!entries[index].leave) push(entry);
    }
  }

  function layer(key, leave) {
    if (restoring) return;
    if (pending) {
      deferred.push(() => layer(key, leave));
      return;
    }
    if (!entries[1]) screen('initial', () => {}, {root: true});
    if (index === 0) armRoot();
    if (entries[index].key !== key) push({key, leave});
  }

  function back() {
    if (index <= 1 || restoring || pending) return false;
    pending = true;
    history.back();
    return true;
  }

  function close(key) {
    if (entries[index]?.key !== key || restoring || pending) return;
    entries[index].leave = () => {};
    back();
  }

  addEventListener('popstate', async event => {
    if (event.state?.pwaNavigation !== session || restoring) return;
    const target = event.state.index;
    const previous = index;
    if (returningFromForward) {
      returningFromForward = false;
      return;
    }
    if (target > previous && target > 1) {
      // A closed form cannot be restored using browser Forward.
      returningFromForward = true;
      history.go(previous - target);
      return;
    }
    index = target;
    restoring = true;
    try {
      if (rootChange) {
        entries.splice(1, entries.length, rootChange);
        rootChange = null;
        if (index === 0) armRoot();
        return;
      }
      if (target > previous) {
        clearExit();
        return;
      }
      const removed = entries.slice(Math.max(target, 1) + 1, previous + 1);
      const onlyLayers = removed.length && removed.every(entry => entry.leave);
      for (const entry of removed.reverse()) await entry.leave?.();
      const current = entries[Math.max(target, 1)];
      if (removed.length && !onlyLayers && current?.restore) {
        await current.restore();
        const page = document.querySelector('#page-scroll');
        if (page) page.scrollTop = current.scroll || 0;
      }
      if (target === 0) {
        showExit();
        // Stay on the original entry so the next system Back can exit normally.
        exitTimer = setTimeout(armRoot, exitDelay);
      }
    } catch (error) {
      console.error('Navigation:', error);
    } finally {
      restoring = false;
      pending = false;
      for (const next of deferred.splice(0)) next();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') clearExit();
    else if (index === 0 && entries[1] && !restoring) armRoot();
  });

  return {screen, layer, close, back};
}
