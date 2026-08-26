(() => {
  "use strict";

  const filterWrap = document.querySelector("[data-resource-filter-wrap]");
  const filter = document.querySelector("[data-resource-filter]");
  const cards = Array.from(document.querySelectorAll(".sky-resource-card[data-editions][data-source]"));
  if (!filterWrap || !filter || cards.length === 0) return;

  filterWrap.hidden = false;

  const checkboxes = Array.from(filter.querySelectorAll("input[type='checkbox'][data-filter-group]"));
  const clearButtons = document.querySelectorAll("[data-resource-filter-clear]");
  const label = filter.querySelector("[data-resource-filter-label]");
  const status = document.querySelector("[data-resource-filter-status]");
  const empty = document.querySelector("[data-resource-filter-empty]");

  function selectedValues(group) {
    return checkboxes
      .filter((checkbox) => checkbox.dataset.filterGroup === group && checkbox.checked)
      .map((checkbox) => checkbox.value);
  }

  function updateCards() {
    const editions = selectedValues("edition");
    const sources = selectedValues("source");
    const activeCount = editions.length + sources.length;
    let visibleCount = 0;

    cards.forEach((card) => {
      const cardEditions = card.dataset.editions.split(/\s+/);
      const matchesEdition = editions.length === 0 || editions.some((edition) => cardEditions.includes(edition));
      const matchesSource = sources.length === 0 || sources.includes(card.dataset.source);
      const visible = matchesEdition && matchesSource;
      card.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    if (label) label.textContent = activeCount ? `Filter sites (${activeCount})` : "Filter sites";
    if (status) status.textContent = activeCount
      ? `Showing ${visibleCount} of ${cards.length} sites`
      : `Showing all ${cards.length} sites`;
    if (empty) empty.hidden = visibleCount !== 0;
  }

  checkboxes.forEach((checkbox) => checkbox.addEventListener("change", updateCards));
  clearButtons.forEach((button) => {
    button.addEventListener("click", () => {
      checkboxes.forEach((checkbox) => { checkbox.checked = false; });
      updateCards();
      filter.open = false;
      filter.querySelector("summary").focus();
    });
  });

  updateCards();
})();
