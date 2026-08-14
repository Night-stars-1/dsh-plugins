/** Global mobile shell behavior: full-width content plus an overlay drawer. */

export const MOBILE_SHELL_STYLE_ID = 'dsh-host-auth-mobile-shell'
const MOBILE_MENU_BUTTON_ID = 'dsh-host-auth-mobile-menu-button'
const MOBILE_MENU_BACKDROP_ID = 'dsh-host-auth-mobile-menu-backdrop'
const MOBILE_HEADER_FALLBACK_ID = 'dsh-host-auth-mobile-header-fallback'

export const MOBILE_SHELL_CSS = `
@media (max-width: 767px) {
  /* The closed drawer must not reserve a desktop sidebar column. */
  [data-dsh-mobile-shell] {
    grid-template-columns: 0 minmax(0, 1fr) 0px !important;
  }

  [data-dsh-mobile-shell] > :first-child {
    width: 0 !important;
    min-width: 0 !important;
    overflow: hidden !important;
    border: 0 !important;
  }

  /* Open the existing SidebarRoot as a drawer above the conversation. */
  [data-dsh-mobile-shell][data-dsh-mobile-menu-open] > :first-child {
    position: fixed;
    inset: 0 auto 0 0;
    width: min(280px, calc(100vw - 48px)) !important;
    overflow: visible !important;
    z-index: 30;
    box-shadow: 12px 0 32px rgb(0 0 0 / 28%);
  }

  [data-dsh-mobile-shell] > :nth-child(3),
  [data-dsh-mobile-shell] > [data-side] {
    display: none !important;
  }

  /* The button lives in dsh's header, or in a header-position fallback on
     the blank hero where the session header intentionally stays hidden. */
  [data-dsh-mobile-header-host] #${MOBILE_MENU_BUTTON_ID},
  #${MOBILE_HEADER_FALLBACK_ID} #${MOBILE_MENU_BUTTON_ID} {
    position: static;
    flex: none;
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--dsw-alias-label-primary);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }

  #${MOBILE_MENU_BUTTON_ID}:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }

  #${MOBILE_HEADER_FALLBACK_ID} {
    display: none;
  }

  #${MOBILE_HEADER_FALLBACK_ID}[data-dsh-mobile-header-fallback-visible] {
    display: flex;
    flex: none;
    align-items: center;
    min-height: 56px;
    padding: 8px 20px;
    box-sizing: border-box;
  }

  #${MOBILE_MENU_BUTTON_ID}:active {
    transform: scale(.96);
  }

  #${MOBILE_MENU_BACKDROP_ID} {
    position: fixed;
    inset: 0;
    z-index: 25;
    display: none;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    background: rgb(0 0 0 / 42%);
    cursor: pointer;
  }

  body[data-dsh-mobile-menu-open] #${MOBILE_MENU_BACKDROP_ID} {
    display: block;
  }

  /* Settings dialog: full-screen and turn the 188px left nav rail into a
     horizontal tab bar on narrow screens. Class suffixes stay stable across
     dsh rebuilds (the leading hash is per-build). */
  [role="dialog"][class$="panel"] {
    width: 100vw !important;
    max-width: 100vw !important;
    height: 100vh !important;
    height: 100dvh !important;
    border-radius: 0 !important;
    flex-direction: column !important;
  }

  [role="dialog"] > nav[class$="nav"] {
    width: 100% !important;
    flex: none !important;
    padding: 14px 16px 0 !important;
    gap: 10px !important;
    box-sizing: border-box !important;
  }

  [role="dialog"] [class$="navList"] {
    flex-direction: row !important;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    gap: 8px !important;
    padding-bottom: 10px !important;
    scrollbar-width: none;
  }

  [role="dialog"] [class$="navList"]::-webkit-scrollbar {
    display: none;
  }

  [role="dialog"] [class$="navCell"] {
    flex: none !important;
    height: 36px !important;
    padding: 6px 14px !important;
    gap: 6px !important;
  }

  [role="dialog"] [class$="navLabel"] {
    flex: none !important;
    overflow: visible !important;
    text-overflow: clip !important;
    white-space: nowrap !important;
  }

  [role="dialog"] [class$="content"] {
    min-height: 0 !important;
  }

  [role="dialog"] [class$="options"] {
    padding: 16px !important;
  }

  /* Move the content header (actions + close) to the top-right, inline with
     the "Settings" title, freeing the content column for the options. */
  [role="dialog"][class$="panel"] [class$="header"] {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 2;
    height: auto !important;
    padding: 0 !important;
    align-items: center !important;
    gap: 4px !important;
  }
}
`

function findShell(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>('[data-shell-overlay]')?.parentElement
    ?? document.querySelector<HTMLElement>('[data-sidebar-collapsed]')
    ?? document.querySelector<HTMLElement>('[data-dsh-mobile-shell]')
    ?? undefined
}

function findConversationRoot(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>('[data-conversation-scroll]')?.closest<HTMLElement>('[data-phase]')
    ?? document.querySelector<HTMLElement>('[data-phase]')
    ?? undefined
}

function findSidebarToggle(shell: HTMLElement): HTMLButtonElement | undefined {
  for (const button of shell.querySelectorAll<HTMLButtonElement>('button')) {
    if ([...button.classList].some(className => className.includes('toggle'))) return button
  }
  return undefined
}

/** Install the drawer controls and keep them placed across SPA re-renders. */
export function installMobileShellStyles(): void {
  const existingStyle = document.getElementById(MOBILE_SHELL_STYLE_ID)
  if (existingStyle !== null) {
    existingStyle.textContent = MOBILE_SHELL_CSS
  } else {
    const style = document.createElement('style')
    style.id = MOBILE_SHELL_STYLE_ID
    style.dataset.plugin = '@night-stars-1/dsh-host-auth'
    style.dataset.pluginCss = MOBILE_SHELL_STYLE_ID
    style.textContent = MOBILE_SHELL_CSS
    document.head.appendChild(style)
  }

  // HMR can leave a previous button/backdrop behind; rebuild them fresh.
  document.getElementById(MOBILE_MENU_BUTTON_ID)?.remove()
  document.getElementById(MOBILE_MENU_BACKDROP_ID)?.remove()

  const menuButton = document.createElement('button')
  menuButton.id = MOBILE_MENU_BUTTON_ID
  menuButton.type = 'button'
  menuButton.setAttribute('aria-label', 'Open menu')
  menuButton.setAttribute('aria-expanded', 'false')
  menuButton.textContent = '\u2630'

  const backdrop = document.createElement('button')
  backdrop.id = MOBILE_MENU_BACKDROP_ID
  backdrop.type = 'button'
  backdrop.setAttribute('aria-label', 'Close menu')
  document.body.append(backdrop)

  let fallback: HTMLDivElement | null = null

  const ensure = (): void => {
    const shell = findShell()
    const conversation = findConversationRoot()
    if (shell === undefined || conversation === undefined) return

    shell.dataset.dshMobileShell = ''

    const header = conversation.querySelector<HTMLElement>('header') ?? undefined
    const hidden = header?.getAttribute('aria-hidden') === 'true'
    const titleRow = hidden ? null : header?.querySelector<HTMLElement>('[class*="titleRow"]')

    // Sync the drawer open state from the shell's collapsed attribute.
    const open = !shell.hasAttribute('data-sidebar-collapsed')
    shell.toggleAttribute('data-dsh-mobile-menu-open', open)
    document.body.toggleAttribute('data-dsh-mobile-menu-open', open)
    menuButton.setAttribute('aria-expanded', String(open))
    menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu')

    if (header !== undefined && titleRow !== null && titleRow !== undefined) {
      header.dataset.dshMobileHeaderHost = ''
      fallback?.remove()
      fallback = null
      if (titleRow.firstElementChild !== menuButton) titleRow.prepend(menuButton)
      return
    }

    // Header absent or hidden: place the button in a header-position fallback.
    if (header !== undefined) delete header.dataset.dshMobileHeaderHost
    if (fallback === null || fallback.parentElement !== conversation) {
      fallback = document.createElement('div')
      fallback.id = MOBILE_HEADER_FALLBACK_ID
      conversation.insertBefore(fallback, conversation.firstElementChild)
    }
    fallback.dataset.dshMobileHeaderFallbackVisible = ''
    if (fallback.firstElementChild !== menuButton) fallback.append(menuButton)
  }

  const onMenuClick = (): void => {
    const shell = findShell()
    if (shell !== undefined) findSidebarToggle(shell)?.click()
  }
  const onBackdropClick = (): void => {
    const shell = findShell()
    if (shell !== undefined && !shell.hasAttribute('data-sidebar-collapsed')) {
      findSidebarToggle(shell)?.click()
    }
  }
  menuButton.addEventListener('click', onMenuClick)
  backdrop.addEventListener('click', onBackdropClick)

  ensure()
  // React owns this DOM and will drop injected nodes on re-render; the
  // subtree observer re-places them. Guards inside `ensure` prevent loops.
  const observer = new MutationObserver(ensure)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-sidebar-collapsed', 'aria-hidden'],
  })
}
