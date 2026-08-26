(() => {
  "use strict";

  const input = document.querySelector("[data-tutorial-search]");
  const cards = [...document.querySelectorAll("[data-tutorial-card]")];
  const status = document.querySelector("[data-tutorial-search-status]");
  const empty = document.querySelector("[data-tutorial-search-empty]");
  if (!input || !cards.length) return;

  function normalize(value) {
    return String(value)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function editDistance(a, b) {
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    const current = new Array(b.length + 1);

    for (let row = 1; row <= a.length; row += 1) {
      current[0] = row;
      for (let column = 1; column <= b.length; column += 1) {
        current[column] = Math.min(
          current[column - 1] + 1,
          previous[column] + 1,
          previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
        );
      }
      for (let column = 0; column <= b.length; column += 1) previous[column] = current[column];
    }

    return previous[b.length];
  }

  function tokenMatches(token, text, words) {
    if (text.includes(token)) return true;
    const tolerance = token.length >= 8 ? 2 : token.length >= 4 ? 1 : 0;
    if (!tolerance) return false;

    return words.some((word) =>
      Math.abs(word.length - token.length) <= tolerance && editDistance(token, word) <= tolerance
    );
  }

  const searchableCards = cards.map((card) => {
    const text = normalize(`${card.textContent} ${card.dataset.search || ""}`);
    return { card, text, words: [...new Set(text.split(" ").filter(Boolean))] };
  });

  function updateResults() {
    const query = normalize(input.value);
    const tokens = query.split(" ").filter(Boolean);
    let visible = 0;

    searchableCards.forEach(({ card, text, words }) => {
      const matches = tokens.every((token) => tokenMatches(token, text, words));
      card.hidden = !matches;
      if (matches) visible += 1;
    });

    if (empty) empty.hidden = visible !== 0;
    if (status) {
      if (!query) status.textContent = `Showing all ${cards.length} tutorials.`;
      else if (visible === 0) status.textContent = `No tutorials found for “${input.value.trim()}”.`;
      else status.textContent = `${visible} tutorial${visible === 1 ? "" : "s"} found.`;
    }
  }

  input.addEventListener("input", updateResults);
  input.addEventListener("search", updateResults);
  updateResults();
})();
