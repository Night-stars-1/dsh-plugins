/** Global shell overrides for the narrow, icon-rail mobile layout. */

export const MOBILE_SHELL_STYLE_ID = 'dsh-host-auth-mobile-shell'

export const MOBILE_SHELL_CSS = `
@media (max-width: 767px) {
  /* AppFrame exposes this state; keep the rail wider than dsh's desktop rail. */
  [data-sidebar-collapsed] {
    grid-template-columns: 82px minmax(0, 1fr) 0px !important;
  }

  /* The first grid cell owns SidebarRoot. Center its 36px controls in 82px. */
  [data-sidebar-collapsed] > :first-child > :first-child {
    width: 100% !important;
    padding-left: 23px !important;
    padding-right: 23px !important;
  }

  /* Details and resize handles are desktop affordances on a phone. */
  [data-sidebar-collapsed] > :nth-child(3),
  [data-sidebar-collapsed] > [data-side] {
    visibility: hidden !important;
    pointer-events: none !important;
  }
}
`

/** Install once; the injected tag applies to every SPA view. */
export function installMobileShellStyles(): void {
  if (document.getElementById(MOBILE_SHELL_STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = MOBILE_SHELL_STYLE_ID
  style.dataset.plugin = '@night-stars-1/dsh-host-auth'
  style.dataset.pluginCss = MOBILE_SHELL_STYLE_ID
  style.textContent = MOBILE_SHELL_CSS
  document.head.appendChild(style)
}
