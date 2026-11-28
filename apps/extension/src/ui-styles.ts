// Local system fonts and code-native decoration only; no external assets.
const colors = `
  --af-ink: #252738;
  --af-muted: #697084;
  --af-line: #e8eaf1;
  --af-accent: #6554d9;
  --af-tint: #f0edff;
  --af-bug: #b94a48;
  --af-praise: #28734f;
  --af-soft: #f7f8fc;
  --af-font: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif;
`;
export const popupStyles = `
  :root { ${colors} color-scheme: light; }
  * { box-sizing: border-box; }
  body { width: 344px; margin: 0; background: #fff; color: var(--af-ink); font: 13px/1.6 var(--af-font); }
  main { width: 344px; max-height: 590px; overflow-y: auto; padding: 22px; }
  button, input { font: inherit; }
  button { cursor: pointer; transition: background .15s, border-color .15s, box-shadow .15s; }
  button:disabled { opacity: .5; cursor: default; }
  button:focus-visible, summary:focus-visible { outline: 3px solid #bfb5ff; outline-offset: 3px; }
  .brand { display: flex; align-items: center; gap: 9px; margin-bottom: 20px; }
  .brand-mark { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 10px; background: var(--af-tint); color: var(--af-accent); }
  .brand h1 { font-size: 14px; letter-spacing: -.25px; font-weight: 700; margin: 0; }
  .actions { margin: 0 0 22px; }
  .open-action { display: flex; align-items: center; gap: 12px; width: 100%; padding: 15px; border: 1px solid var(--af-accent); border-radius: 12px; background: var(--af-accent); color: #fff; text-align: left; box-shadow: 0 3px 8px #6554d91c; }
  .open-action:hover:not(:disabled) { background: #5947c9; border-color: #5947c9; box-shadow: 0 4px 12px #6554d92e; }
  .action-icon { width: 35px; height: 35px; display: grid; place-items: center; flex-shrink: 0; border-radius: 10px; background: #ffffff1a; }
  .action-copy { flex: 1; }
  .action-label { display: block; font-size: 14px; font-weight: 650; line-height: 1.6; }
  .action-caption { display: block; margin-top: 1px; font-size: 11px; color: #f1edff; }
  .action-arrow { opacity: .85; }
  .account { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .avatar { width: 34px; height: 34px; flex-shrink: 0; display: grid; place-items: center; border-radius: 50%; background: var(--af-soft); color: var(--af-muted); font-weight: 650; }
  .account-copy { flex: 1; display: grid; gap: 1px; min-width: 0; }
  .account-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 600; }
  .participation { display: flex; align-items: center; gap: 5px; color: var(--af-muted); font-size: 11px; }
  .presence { width: 5px; height: 5px; background: #3e946e; border-radius: 50%; }
  .settings { border-top: 1px solid var(--af-line); margin-top: 18px; padding-top: 12px; }
  .settings-actions { display: grid; gap: 5px; margin-top: 10px; }
  .settings button { padding: 9px 10px; text-align: left; border: 0; border-radius: 7px; color: var(--af-muted); background: transparent; font-size: 12px; }
  .settings button:hover:not(:disabled) { background: var(--af-soft); color: var(--af-ink); }
  .account .leave { display: grid; place-items: center; flex-shrink: 0; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--af-muted); }
  .account .leave:hover:not(:disabled) { background: #fff3f2; color: #a04b50; }
  .join-heading { margin: 22px 0 16px; }
  .join-heading h2 { font-size: 20px; margin: 0 0 5px; }
  .join-heading p { color: var(--af-muted); font-size: 12px; margin: 0; }
  .join-submit { width: 100%; border: 0; border-radius: 9px; background: var(--af-accent); color: #fff; padding: 11px; margin-top: 5px; font-weight: 600; }
  .join-submit:hover:not(:disabled) { background: #5947c9; }
  .loading { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 120px; color: var(--af-muted); font-size: 12px; }
  .spinner { height: 14px; width: 14px; border: 2px solid var(--af-line); border-top-color: var(--af-accent); border-radius: 50%; animation: af-spin .8s linear infinite; }
  .error { background: #fff3f2; border: 1px solid #f3d7d4; border-radius: 8px; color: #9b3e3b; padding: 10px; margin: 14px 0 0; font-size: 12px; overflow-wrap: anywhere; }
  .extension-feedback { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--af-line); color: var(--af-muted); font-size: 11px; }
  .extension-feedback summary { cursor: pointer; }
  .extension-feedback form { display: grid; gap: 8px; margin-top: 12px; }
  .extension-feedback label { color: var(--af-ink); }
  .extension-feedback textarea { box-sizing: border-box; width: 100%; min-height: 95px; resize: vertical; padding: 9px; border: 1px solid var(--af-line); border-radius: 8px; color: var(--af-ink); background: #fff; font: inherit; font-size: 12px; }
  .extension-feedback textarea:focus-visible { outline: 2px solid var(--af-accent); outline-offset: 1px; }
  .extension-feedback p { margin: 0; overflow-wrap: anywhere; }
  .extension-feedback button { border: 1px solid var(--af-line); border-radius: 7px; background: var(--af-soft); color: var(--af-ink); padding: 8px; font-size: 12px; }
  .extension-feedback [role="alert"] { color: #9b3e3b; }
  @keyframes af-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
`;
export const panelStyles = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  .af-surface { ${colors} font: 13px/1.6 var(--af-font); color: var(--af-ink); }
  section { position: fixed; right: 18px; top: 18px; width: min(328px, calc(100vw - 36px)); max-height: min(82vh, 660px); overflow: auto; background: #fff; color: var(--af-ink); padding: 17px; border: 1px solid var(--af-line); border-radius: 15px; font: 13px/1.6 var(--af-font); box-shadow: 0 8px 32px #20243c14, 0 1px 4px #20243c08; pointer-events: auto; }
  button, textarea, input { font: inherit; }
  button { cursor: pointer; transition: background .15s, border-color .15s; }
  button:disabled { opacity: .5; cursor: default; }
  button:focus-visible, summary:focus-visible { outline: 3px solid #bfb5ff; outline-offset: 2px; }
  .panel-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .panel-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 650; }
  .panel-title svg { color: var(--af-accent); }
  .panel-close { display: grid; place-items: center; flex-shrink: 0; height: 30px; width: 30px; border: 0; border-radius: 8px; background: transparent; color: var(--af-muted); font-size: 21px; line-height: 1; }
  .panel-close:hover { background: var(--af-soft); }
  .panel-status { color: var(--af-muted); font-size: 12px; margin: 8px 0 12px; overflow-wrap: anywhere; }
  section[data-mode="empty"] .panel-status { padding: 23px 10px; text-align: center; background: var(--af-soft); border: 1px dashed #e0e3ef; border-radius: 10px; }
  section[data-mode="select"] .panel-status { padding: 10px 12px; background: var(--af-tint); color: #5846bd; border-radius: 9px; }
  .write-action { width: 100%; padding: 10px 12px; border: 1px solid #e1dcfa; border-radius: 9px; background: var(--af-tint); color: #5846bd; font-size: 12px; font-weight: 600; }
  .write-action:hover { background: #e8e2ff; }
  ol { display: grid; gap: 9px; padding: 0; margin: 13px 0 0; list-style: none; }
  ol:empty { display: none; }
  li { background: var(--af-soft); border: 1px solid transparent; padding: 0; border-radius: 10px; overflow-wrap: anywhere; outline: none; }
  li.is-active { border-color: #c5bbfa; background: #f3f0ff; }
  .comment-action { display: block; width: 100%; padding: 11px 12px; text-align: left; color: inherit; background: transparent; border: 0; border-radius: 10px; }
  .comment-action:hover:not(:disabled) { background: #ece8fa; }
  .list-tools { display: flex; justify-content: flex-end; margin-top: 10px; }
  .copy-action { padding: 5px 8px; color: var(--af-muted); border: 1px solid var(--af-line); border-radius: 6px; background: #fff; font-size: 11px; }
  .copy-action:hover:not(:disabled) { color: var(--af-accent); background: var(--af-tint); }
  .feedback-preview { position: fixed; width: min(280px, calc(100vw - 16px)); max-height: min(224px, calc(100vh - 16px)); overflow: auto; pointer-events: auto; background: #fff; padding: 12px; border: 1px solid #c5bbfa; border-radius: 12px; box-shadow: 0 5px 24px #20243c25; overflow-wrap: anywhere; }
  .comment-meta { display: flex; align-items: center; gap: 8px; }
  .comment-number { color: var(--af-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  [data-category="bug"] { --af-category-color: var(--af-bug); --af-category-tint: #fceae7; }
  [data-category="suggestion"] { --af-category-color: var(--af-accent); --af-category-tint: var(--af-tint); }
  [data-category="praise"] { --af-category-color: var(--af-praise); --af-category-tint: #e7f3ec; }
  .comment-category { flex-shrink: 0; font-size: 11px; font-weight: 550; color: var(--af-category-color, var(--af-accent)); background: var(--af-category-tint, var(--af-tint)); border-radius: 4px; padding: 1px 5px; }
  .comment-author { color: var(--af-muted); font-size: 11px; margin: 5px 0 0; overflow-wrap: anywhere; }
  .comment-meta .comment-author { margin: 0 0 0 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .comment-body { display: block; white-space: pre-wrap; margin: 7px 0 0; font-size: 13px; line-height: 1.8; }
  .unavailable { display: block; color: var(--af-muted); margin: 5px 0 0; font-size: 11px; }
  form { display: grid; gap: 12px; margin-top: 12px; }
  label { display: grid; gap: 6px; font-size: 11px; color: var(--af-muted); }
  textarea { display: block; width: 100%; min-height: 100px; resize: vertical; padding: 10px; background: #fff; border: 1px solid #dfe2ec; border-radius: 9px; color: var(--af-ink); font-size: 12px; line-height: 1.8; outline: none; }
  textarea::placeholder { color: #9298a8; }
  textarea:focus { border-color: var(--af-accent); box-shadow: 0 0 0 3px var(--af-tint); }
  .category-picker { display: flex; gap: 6px; padding: 0; margin: 0; min-width: 0; border: 0; }
  .category-picker legend { padding: 0; margin-bottom: 6px; font-size: 11px; color: var(--af-muted); }
  .category-option { position: relative; flex: 1; min-width: 0; cursor: pointer; }
  .category-option input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .category-option span { display: block; text-align: center; padding: 8px 3px; border: 1px solid var(--af-line); border-radius: 7px; background: #fff; color: var(--af-muted); font-size: 11px; }
  .category-option:hover span { background: var(--af-soft); }
  .category-option input:checked + span { color: var(--af-category-color); background: var(--af-category-tint); border-color: var(--af-category-color); font-weight: 600; }
  .category-option input:focus-visible + span { outline: 3px solid #bfb5ff; outline-offset: 2px; }
  .form-actions { display: flex; gap: 8px; }
  .form-actions button { padding: 9px 12px; border: 1px solid var(--af-line); border-radius: 8px; color: var(--af-muted); background: #fff; font-size: 12px; }
  .form-actions button[type="submit"] { flex: 1; background: var(--af-accent); border-color: var(--af-accent); color: #fff; font-weight: 600; }
  .highlight { position: fixed; border: 2px solid #8b79ec; background: #8975ec12; border-radius: 4px; pointer-events: none; }
  .pin { position: fixed; border-radius: 50%; background: var(--af-category-color, var(--af-accent)); color: #fff; border: 2px solid #fff; pointer-events: auto; width: 28px; height: 28px; padding: 0; font-size: 11px; font-weight: 650; line-height: 24px; text-align: center; box-shadow: 0 2px 7px #49377e35; }
  .pin:hover { filter: brightness(.9); }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; } }
`;
