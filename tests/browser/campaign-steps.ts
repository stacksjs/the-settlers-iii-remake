export const campaignSteps = [
  { action: 'wait', ms: 1500 },
  {
    action: 'evaluate',
    expression: String.raw`(async () => {
      const response = await fetch('/assets/settlers-original/ui-manifest.json');
      if (!response.ok) throw new Error('Original interface manifest was not delivered');
      const manifest = await response.json();
      if (manifest.version !== 1 || manifest.images?.length !== 52) throw new Error('Invalid original interface manifest');
      const keys = new Set();
      await Promise.all(manifest.images.map(async entry => {
        if (keys.has(entry.key) || !/^ui\/[a-z0-9-]+\.png$/.test(entry.path)) throw new Error('Invalid original interface image identity');
        keys.add(entry.key);
        const image = new Image();
        image.src = '/assets/settlers-original/' + entry.path;
        await image.decode();
        if (image.naturalWidth !== entry.width || image.naturalHeight !== entry.height) throw new Error('Original interface dimensions differ: ' + entry.key);
      }));
      return { originalInterfaceImagesDecoded: keys.size };
    })()`,
  },
  { action: 'assert', selector: '.campaign-name', text: 'Generated landscape' },
  { action: 'assert', selector: '.map-location', text: 'Generated landscape' },
  // Choosing a building moves the keyboard cursor to the nearest valid site.
  { action: 'click', selector: '.building-choice', text: 'Sawmill' },
  { action: 'press', key: 'Enter' },
  { action: 'assert', selector: '[role=status]', text: 'Sawmill site placed.' },
  { action: 'assert', selector: '.settlement-count', text: '2 buildings' },
  { action: 'click', selector: '.map-button', text: '4x' },
  { action: 'assert', selector: '.map-button[aria-pressed=true]', text: '4x' },
  { action: 'wait', ms: 1200 },
  { action: 'click', selector: '.map-button', text: 'Pause' },
  { action: 'assert', selector: '.map-button[aria-pressed=true]', text: 'Play' },
  { action: 'click', selector: 'header button', text: 'Save' },
  { action: 'wait', ms: 200 },
  { action: 'assert', selector: '[role=status]', text: 'Settlement saved on this device.' },
  { action: 'evaluate', expression: 'location.reload(); true' },
  { action: 'wait', ms: 1500 },
  { action: 'assert', selector: '[role=status]', text: 'Your settlement has been restored.' },
  { action: 'assert', selector: '.settlement-count', text: '2 buildings' },
  { action: 'focus', selector: 'header button', text: 'Sound off' },
  { action: 'press', key: 'Enter' },
  // Observe completion of the first ambience fetch and decode.
  { action: 'assert', selector: 'header button', text: 'Sound on', timeoutMs: 2000 },
  { action: 'focus', selector: 'header button', text: 'Sound on' },
  { action: 'press', key: 'Enter' },
  { action: 'assert', selector: 'header button', text: 'Sound off', timeoutMs: 2000 },
  { action: 'click', selector: '.building-choice', text: "Woodcutter's hut" },
  { action: 'evaluate', expression: "dispatchEvent(new PageTransitionEvent('pagehide')); true" },
  { action: 'wait', ms: 200 },
  { action: 'assert', selector: '[role=status]', text: 'Settlement saved on this device.' },
  { action: 'evaluate', expression: "dispatchEvent(new PageTransitionEvent('pageshow')); true" },
  { action: 'click', selector: 'header button', text: 'New settlement' },
  { action: 'click', selector: '.restart-panel button', text: 'Original tutorial map' },
  { action: 'assert', selector: '.campaign-name', text: 'Original tutorial map', timeoutMs: 10000 },
  { action: 'assert', selector: '.map-location', text: 'Original tutorial map' },
  { action: 'assert', selector: '.population strong', text: '51' },
  { action: 'click', selector: 'header button', text: 'Save' },
  { action: 'assert', selector: '[role=status]', text: 'Settlement saved on this device.' },
  { action: 'evaluate', expression: 'location.reload(); true' },
  { action: 'assert', selector: '.campaign-name', text: 'Original tutorial map', timeoutMs: 10000 },
  { action: 'assert', selector: '.map-location', text: 'Original tutorial map' },
  { action: 'assert', selector: '[role=status]', text: 'Your settlement has been restored.' },

]
