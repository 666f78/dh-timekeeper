(() => {
  const SECOND = 1;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const MS_PER_SECOND = 1000;
  const TICK_INTERVAL_MS = SECOND * MS_PER_SECOND;

  const DEFAULT_LOCALE = 'en-GB';
  const DATE_FORMAT: Intl.DateTimeFormatOptions = {
    hour12: false,
    year: 'numeric',
    weekday: 'short',
    month: 'long',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  };

  const CLASS = {
    container: 'dht-timekeeper',
    clock: 'dht-timekeeper__clock',
    toolbar: 'dht-timekeeper__toolbar',
    button: 'dht-button',
    unitSelect: 'dht-unit-select',
    inlinePanel: 'dht-settime',
    inlineGrid: 'dht-settime__grid',
    inlineCell: 'dht-settime__cell',
    inlineActions: 'dht-settime__actions',
  } as const;

  const SELECTOR = {
    container: `.${CLASS.container}`,
    clock: `.${CLASS.clock}`,
    toolbar: `.${CLASS.toolbar}`,
    unitSelect: `.${CLASS.unitSelect}`,
    inlinePanel: `.${CLASS.inlinePanel}`,
  } as const;

  type TimeParts = {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };

  type TimeKey = keyof TimeParts;
  type ButtonAction = 'play' | 'pause' | 'set' | 'adv';
  type TimeUnit = 'second' | 'minute' | 'hour' | 'day' | 'month' | 'year';

  const TIME_KEYS: readonly TimeKey[] = ['year', 'month', 'day', 'hour', 'minute', 'second'];
  const LIMITS: Record<TimeKey, { min: number; max: number }> = {
    year: { min: 1, max: 9999 },
    month: { min: 1, max: 12 },
    day: { min: 1, max: 31 },
    hour: { min: 0, max: 23 },
    minute: { min: 0, max: 59 },
    second: { min: 0, max: 59 },
  };

  const STEP_VALUES = [-10, -5, -1, 1, 5, 10] as const;
  const STEP_ICONS: Record<(typeof STEP_VALUES)[number], string> = {
    [-10]: 'fa-solid fa-angles-left',
    [-5]: 'fa-solid fa-caret-left',
    [-1]: 'fa-solid fa-angle-left',
    [1]: 'fa-solid fa-angle-right',
    [5]: 'fa-solid fa-caret-right',
    [10]: 'fa-solid fa-angles-right',
  };

  const UNIT_OPTIONS: readonly { value: TimeUnit; label: string }[] = [
    { value: 'second', label: 'Seconds' },
    { value: 'minute', label: 'Minutes' },
    { value: 'hour', label: 'Hours' },
    { value: 'day', label: 'Days' },
    { value: 'month', label: 'Months' },
    { value: 'year', label: 'Years' },
  ];

  const INLINE_FIELDS: readonly { key: TimeKey; label: string }[] = [
    { key: 'day', label: 'Day' },
    { key: 'month', label: 'Month' },
    { key: 'year', label: 'Year' },
    { key: 'hour', label: 'Hour' },
    { key: 'minute', label: 'Minute' },
    { key: 'second', label: 'Second' },
  ];

  let currentUnit: TimeUnit = 'second';
  let tickerId: number | null = null;
  let ticking = false;

  function requireTime(): NonNullable<typeof game.time> {
    if (!game.time) throw new Error("Foundry 'game.time' is not ready.");
    return game.time;
  }

  function isActiveGM(): boolean {
    const active = game.users?.activeGM;
    return Boolean(active && active.id === game.userId);
  }

  function resolveHost(root: unknown): HTMLElement | null {
    if (!root) return null;
    if (root instanceof HTMLElement) return root;
    const maybeJQuery = root as { [key: number]: HTMLElement } | undefined;
    if (maybeJQuery && maybeJQuery[0] instanceof HTMLElement) return maybeJQuery[0];
    return ui?.players?.element ?? null;
  }

  function withPlayersElement(cb: (el: HTMLElement) => void): void {
    const el = ui.players?.element;
    if (el) cb(el);
  }

  function currentEpochMs(): number {
    return requireTime().worldTime * MS_PER_SECOND;
  }

  function toParts(ms: number): TimeParts {
    const d = new Date(ms);
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      second: d.getSeconds(),
    };
  }

  function validParts(parts: TimeParts): boolean {
    return TIME_KEYS.every((key) => {
      const value = parts[key];
      const { min, max } = LIMITS[key];
      return Number.isFinite(value) && value >= min && value <= max;
    });
  }

  function formatCurrentTime(): string {
    return new Date(currentEpochMs()).toLocaleString(DEFAULT_LOCALE, DATE_FORMAT);
  }

  function createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = CLASS.container;

    const clock = document.createElement('div');
    clock.className = CLASS.clock;
    clock.setAttribute('role', 'status');
    clock.setAttribute('aria-live', 'polite');
    container.append(clock);

    const toolbar = document.createElement('div');
    toolbar.className = CLASS.toolbar;
    toolbar.addEventListener('click', onToolbarClick);
    container.append(toolbar);

    return container;
  }

  function ensureContainer(host: HTMLElement): HTMLElement {
    let container = host.querySelector<HTMLElement>(SELECTOR.container);
    if (!container) {
      container = createContainer();
      host.appendChild(container);
    }
    return container;
  }

  function updateClock(container: HTMLElement): void {
    const clock = container.querySelector<HTMLElement>(SELECTOR.clock);
    if (clock) clock.textContent = formatCurrentTime();
  }

  function renderToolbarContent(toolbar: HTMLElement): void {
    const elements: Array<HTMLElement> = [
      createActionButton('set', 'Set world time', 'fa-solid fa-calendar-days'),
      createActionButton('play', 'Start automatic ticking', 'fa-solid fa-play'),
      createActionButton('pause', 'Pause automatic ticking', 'fa-solid fa-pause'),
    ];

    for (const step of STEP_VALUES) if (step < 0) elements.push(createStepButton(step));
    elements.push(createUnitSelect());
    for (const step of STEP_VALUES) if (step > 0) elements.push(createStepButton(step));

    toolbar.replaceChildren(...elements);
  }

  function updateControls(container?: HTMLElement | null): void {
    const target = container ?? document.querySelector<HTMLElement>(SELECTOR.container);
    if (!target) return;

    const toolbar = target.querySelector<HTMLElement>(SELECTOR.toolbar);
    if (!toolbar) return;

    const gm = Boolean(game.user?.isGM);
    toolbar.style.display = gm ? '' : 'none';

    if (gm) {
      if (toolbar.dataset.role !== 'gm') {
        renderToolbarContent(toolbar);
        toolbar.dataset.role = 'gm';
      }

      const play = toolbar.querySelector<HTMLButtonElement>('[data-action="play"]');
      if (play) play.hidden = ticking;

      const pause = toolbar.querySelector<HTMLButtonElement>('[data-action="pause"]');
      if (pause) pause.hidden = !ticking;

      const unitSelect = toolbar.querySelector<HTMLSelectElement>(SELECTOR.unitSelect);
      if (unitSelect && unitSelect.value !== currentUnit) unitSelect.value = currentUnit;
    } else if (toolbar.dataset.role === 'gm') {
      toolbar.replaceChildren();
      toolbar.dataset.role = 'player';
    }
  }

  function createIconElement(iconClass: string): HTMLElement | null {
    const trimmed = iconClass.trim();
    if (!trimmed) return null;
    const icon = document.createElement('i');
    icon.className = trimmed;
    icon.classList.add('fa-fw');
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  function createActionButton(action: ButtonAction, title: string, iconClass: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.add(CLASS.button);
    button.dataset.action = action;
    button.title = title;
    button.setAttribute('aria-label', title);
    const icon = createIconElement(iconClass);
    if (icon) button.append(icon);
    return button;
  }

  function createStepButton(step: (typeof STEP_VALUES)[number]): HTMLButtonElement {
    const label = `${step > 0 ? '+' : ''}${step} selected ${Math.abs(step) === 1 ? 'unit' : 'units'}`;
    const button = createActionButton('adv', label, STEP_ICONS[step] ?? '');
    button.dataset.step = String(step);
    if (!STEP_ICONS[step]) button.textContent = step > 0 ? `+${step}` : `${step}`;
    return button;
  }

  function createUnitSelect(): HTMLSelectElement {
    const select = document.createElement('select');
    select.classList.add(CLASS.unitSelect);
    select.title = 'Adjustment unit';
    select.setAttribute('aria-label', 'Adjustment unit');

    for (const option of UNIT_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = option.value;
      opt.textContent = option.label;
      select.append(opt);
    }

    select.value = currentUnit;
    select.addEventListener(
      'change',
      (event) => {
        currentUnit = (event.target as HTMLSelectElement).value as TimeUnit;
        for (const other of document.querySelectorAll<HTMLSelectElement>(SELECTOR.unitSelect)) {
          if (other !== event.target && other.value !== currentUnit) other.value = currentUnit;
        }
      },
      { passive: true },
    );

    return select;
  }

  function buildInlineSetPanel(parts: TimeParts): HTMLElement {
    const panel = document.createElement('div');
    panel.className = CLASS.inlinePanel;

    const grid = document.createElement('div');
    grid.className = CLASS.inlineGrid;

    for (const field of INLINE_FIELDS) {
      const cell = document.createElement('div');
      cell.className = CLASS.inlineCell;

      const label = document.createElement('label');
      label.textContent = field.label;
      const input = document.createElement('input');
      input.type = 'number';
      input.name = field.key;
      const { min, max } = LIMITS[field.key];
      input.min = String(min);
      input.max = String(max);
      input.value = String(parts[field.key]);
      input.inputMode = 'numeric';

      cell.append(label, input);
      grid.append(cell);
    }

    const actions = document.createElement('div');
    actions.className = CLASS.inlineActions;

    const apply = document.createElement('button');
    apply.type = 'button';
    apply.dataset.act = 'apply';
    apply.textContent = 'Set';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.dataset.act = 'cancel';
    cancel.textContent = 'Cancel';

    actions.append(apply, cancel);
    panel.append(grid, actions);

    return panel;
  }

  function readInlineParts(panel: HTMLElement): TimeParts {
    const read = (key: TimeKey) =>
      Number.parseInt(panel.querySelector<HTMLInputElement>(`input[name="${key}"]`)?.value ?? '', 10);
    return {
      year: read('year'),
      month: read('month'),
      day: read('day'),
      hour: read('hour'),
      minute: read('minute'),
      second: read('second'),
    };
  }

  function showInlineSet(container: HTMLElement): void {
    if (container.querySelector(SELECTOR.inlinePanel)) return;

    const panel = buildInlineSetPanel(toParts(currentEpochMs()));
    container.append(panel);

    panel.addEventListener('click', async (event) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-act]');
      if (!button) return;

      const action = button.dataset.act;
      if (action === 'cancel') {
        panel.remove();
        return;
      }

      if (action === 'apply') {
        const parts = readInlineParts(panel);
        if (!validParts(parts)) {
          ui.notifications?.warn('Invalid date or time values.');
          return;
        }

        const targetDate = new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
        await requireTime().set(targetDate.getTime() / MS_PER_SECOND);
        withPlayersElement(renderBlock);
        panel.remove();
      }
    });
  }

  function startTicker(): void {
    if (tickerId !== null || !isActiveGM()) return;
    ticking = true;
    tickerId = window.setInterval(() => {
      if (document.hidden || game.paused) return;
      requireTime().advance(SECOND);
      withPlayersElement(renderBlock);
    }, TICK_INTERVAL_MS);
    updateControls();
  }

  function stopTicker(): void {
    if (tickerId !== null) {
      clearInterval(tickerId);
      tickerId = null;
    }
    ticking = false;
    updateControls();
  }

  async function addMonths(delta: number): Promise<void> {
    const date = new Date(currentEpochMs());
    date.setMonth(date.getMonth() + delta);
    await requireTime().set(date.getTime() / MS_PER_SECOND);
  }

  async function addYears(delta: number): Promise<void> {
    const date = new Date(currentEpochMs());
    date.setFullYear(date.getFullYear() + delta);
    await requireTime().set(date.getTime() / MS_PER_SECOND);
  }

  function advanceBy(step: number, unit: TimeUnit): Promise<number> | Promise<void> | void {
    switch (unit) {
      case 'second':
        return requireTime().advance(step * SECOND);
      case 'minute':
        return requireTime().advance(step * MINUTE);
      case 'hour':
        return requireTime().advance(step * HOUR);
      case 'day':
        return requireTime().advance(step * DAY);
      case 'month':
        return addMonths(step);
      case 'year':
        return addYears(step);
    }
  }

  const ACTION_HANDLERS: Record<ButtonAction, (button: HTMLButtonElement) => void | Promise<void>> = {
    play: () => startTicker(),
    pause: () => stopTicker(),
    set: (button) => {
      const container = button.closest<HTMLElement>(SELECTOR.container);
      if (container) showInlineSet(container);
    },
    adv: (button) => {
      const step = Number(button.dataset.step ?? 0);
      if (!Number.isFinite(step) || step === 0) return;
      const container = button.closest<HTMLElement>(SELECTOR.container);
      const unitSelect = container?.querySelector<HTMLSelectElement>(SELECTOR.unitSelect);
      const unit = (unitSelect?.value as TimeUnit | undefined) ?? currentUnit;
      return Promise.resolve(advanceBy(step, unit));
    },
  };

  async function onToolbarClick(event: Event): Promise<void> {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-action]');
    if (!button) return;

    const action = button.dataset.action as ButtonAction | undefined;
    if (!action) return;

    const handler = ACTION_HANDLERS[action];
    if (!handler) return;

    await handler(button);

    const container = button.closest<HTMLElement>(SELECTOR.container);
    if (container) {
      updateClock(container);
      updateControls(container);
    }
  }

  function renderBlock(root: unknown): void {
    const host = resolveHost(root);
    if (!host) return;

    const container = ensureContainer(host);
    updateClock(container);
    updateControls(container);
  }

  Hooks.on('ready', () => {
    if (!game.time) return;
    withPlayersElement(renderBlock);
    updateControls();
  });

  Hooks.on('updateUser', (_user, changes) => {
    if ('active' in changes || 'role' in changes) {
      if (!isActiveGM()) stopTicker();
      updateControls();
    }
  });

  Hooks.on('renderPlayers', (_app, html) => renderBlock(html));
  Hooks.on('updateWorldTime', () => withPlayersElement(renderBlock));

  // Debug helpers for console use
  // @ts-ignore
  globalThis.DHTK = {
    start: startTicker,
    stop: stopTicker,
    render: () => withPlayersElement(renderBlock),
    get ticking() {
      return ticking;
    },
    get unit() {
      return currentUnit;
    },
    set unit(value: TimeUnit) {
      currentUnit = value;
      for (const select of document.querySelectorAll<HTMLSelectElement>(SELECTOR.unitSelect)) {
        if (select.value !== currentUnit) select.value = currentUnit;
      }
    },
  };
})();
