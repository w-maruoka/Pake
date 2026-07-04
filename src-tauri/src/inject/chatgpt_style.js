window.addEventListener("DOMContentLoaded", () => {
  const contentStyleElement = document.createElement("style");
  contentStyleElement.textContent = `
    #pake-top-dom {
      position: fixed;
      background: transparent;
      top: 0;
      left: 0;
      width: 100%;
      height: 20px;
      cursor: grab;
      -webkit-app-region: drag;
      user-select: none;
      -webkit-user-select: none;
      z-index: 99999;
    }

    #pake-top-dom:active {
      cursor: grabbing;
      cursor: -webkit-grabbing;
    }

    body > div.relative.flex.h-full.w-full.overflow-hidden.transition-colors.z-0 > div.z-\\[21\\].flex-shrink-0.overflow-x-hidden.bg-token-sidebar-surface-primary.max-md\\:\\!w-0 > div > div > div > nav > div.flex.justify-between.h-\\[60px\\].items-center.md\\:h-header-height {
      padding-top: 25px;
    }

    body > div.relative.flex.h-full.w-full.overflow-hidden.transition-colors.z-0 > div.relative.flex.h-full.max-w-full.flex-1.flex-col.overflow-hidden > main > div.composer-parent.flex.h-full.flex-col.focus-visible\\:outline-0 > div.flex-1.overflow-hidden.\\@container\\/thread > div > div.absolute.left-0.right-0 > div {
      padding-top: 35px;
    }

    #__next .overflow-hidden > .overflow-x-hidden .scrollbar-trigger > nav {
      padding-top: 12px;
    }

    #__next > div.relative.z-0.flex.h-full.w-full.overflow-hidden > div.flex-shrink-0.overflow-x-hidden.bg-token-sidebar-surface-primary > div > div > div > div > nav,
    #__next > div.relative.z-0.flex.h-full.w-full.overflow-hidden > div.relative.flex.h-full.max-w-full.flex-1.flex-col.overflow-hidden > main {
      padding-top: 6px;
    }
  `;
  document.head.appendChild(contentStyleElement);
});
