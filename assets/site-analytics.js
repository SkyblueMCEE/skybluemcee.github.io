(() => {
  "use strict";

  // Add the GA4 web stream's Measurement ID here (for example, G-ABC123DEF4).
  // Until a valid ID is present, Google Analytics and the consent banner stay disabled.
  const GA_MEASUREMENT_ID = "G-8JTPTPR1NW";
  const LIVE_HOST = "skybluemcee.github.io";
  const CONSENT_KEY = "skyblue_google_analytics_consent_v1";
  const banner = document.querySelector("[data-analytics-consent]");
  const manageButton = document.querySelector("[data-analytics-consent-manage]");
  const acceptButton = document.querySelector("[data-analytics-consent-accept]");
  const declineButton = document.querySelector("[data-analytics-consent-decline]");

  if (
    location.hostname !== LIVE_HOST ||
    !/^G-[A-Z0-9]+$/.test(GA_MEASUREMENT_ID) ||
    !banner ||
    !manageButton ||
    !acceptButton ||
    !declineButton
  ) return;

  let analyticsLoaded = false;

  const readChoice = () => {
    try { return localStorage.getItem(CONSENT_KEY); }
    catch { return null; }
  };

  const saveChoice = (choice) => {
    try { localStorage.setItem(CONSENT_KEY, choice); }
    catch { /* The choice will apply only to this page if storage is blocked. */ }
  };

  const setBannerOpen = (open) => {
    banner.hidden = !open;
    if (open) acceptButton.focus();
  };

  const removeAnalyticsCookies = () => {
    document.cookie.split(";").forEach((entry) => {
      const name = entry.split("=")[0].trim();
      if (name === "_ga" || name.startsWith("_ga_")) {
        document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
      }
    });
  };

  const loadAnalytics = () => {
    if (analyticsLoaded) return;
    analyticsLoaded = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };

    window.gtag("consent", "default", {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied"
    });
    window.gtag("consent", "update", { analytics_storage: "granted" });
    window.gtag("set", "ads_data_redaction", true);

    const tag = document.createElement("script");
    tag.async = true;
    tag.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
    document.head.append(tag);

    window.gtag("js", new Date());
    window.gtag("config", GA_MEASUREMENT_ID, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });
  };

  const declineAnalytics = () => {
    saveChoice("declined");
    if (window.gtag) {
      window.gtag("consent", "update", {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied"
      });
    }
    removeAnalyticsCookies();
    setBannerOpen(false);
  };

  acceptButton.addEventListener("click", () => {
    saveChoice("accepted");
    setBannerOpen(false);
    loadAnalytics();
  });
  declineButton.addEventListener("click", declineAnalytics);
  manageButton.addEventListener("click", () => setBannerOpen(true));

  manageButton.hidden = false;
  const choice = readChoice();
  if (choice === "accepted") loadAnalytics();
  else if (choice !== "declined") setBannerOpen(true);
})();
