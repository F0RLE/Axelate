export const mountLogos = (): void => {
    const splashContainer = document.querySelector<HTMLElement>('.splash-logo-container');
    if (splashContainer && !splashContainer.querySelector('svg')) {
        splashContainer.innerHTML += `
                    <div class="splash-glow"></div>
                    <svg
                        class="splash-logo-svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="url(#splash-grad)"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <defs>
                            <linearGradient
                                id="splash-grad"
                                x1="0%"
                                y1="0%"
                                x2="100%"
                                y2="100%"
                            >
                                <stop offset="0%" stop-color="#8a2be2" />
                                <stop offset="100%" stop-color="#5ddcff" />
                            </linearGradient>
                        </defs>
                        <path
                            d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                        />
                    </svg>
        `;
    }

    const sidebarLogo = document.querySelector<HTMLElement>('.sidebar-logo-icon');
    if (sidebarLogo && !sidebarLogo.querySelector('svg')) {
        sidebarLogo.innerHTML = `
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="url(#sidebar-logo-grad)"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <defs>
                            <linearGradient
                                id="sidebar-logo-grad"
                                x1="0%"
                                y1="0%"
                                x2="100%"
                                y2="100%"
                            >
                                <stop offset="0%" stop-color="#8a2be2" />
                                <stop offset="100%" stop-color="#5ddcff" />
                            </linearGradient>
                        </defs>
                        <path
                            d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                        />
                    </svg>
        `;
    }
};

mountLogos();
