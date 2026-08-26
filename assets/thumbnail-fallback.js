(() => {
  "use strict";

  document.querySelectorAll("img[data-fallback-1]").forEach((image) => {
    function useNextThumbnail() {
      const next = image.getAttribute("data-fallback-1") || image.getAttribute("data-fallback-2");

      if (image.hasAttribute("data-fallback-1")) image.removeAttribute("data-fallback-1");
      else {
        image.removeAttribute("data-fallback-2");
        image.removeEventListener("error", useNextThumbnail);
      }

      if (next) image.src = next;
    }

    image.addEventListener("error", useNextThumbnail);
  });
})();
