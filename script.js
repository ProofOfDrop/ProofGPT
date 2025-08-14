async function loadPage() {
  const res = await fetch("proofdrop.json");
  const data = await res.json();
  const app = document.getElementById("app");

  data.page.sections.forEach(section => {
    const el = document.createElement("section");

    if (section.type === "hero") {
      el.innerHTML = `
        <h1>${section.title}</h1>
        <p>${section.subtitle}</p>
        ${section.ctaButtons.map(btn => `
          <button onclick="window.location.href='${btn.action}'">${btn.label}</button>
        `).join("")}
      `;
    }

    if (section.type === "section") {
      el.innerHTML = `<h2>${section.title}</h2>${section.content.map(c => `<p>${c}</p>`).join("")}`;
    }

    if (section.type === "how_it_works") {
      el.innerHTML = `<h2>${section.title}</h2>
        <ol>
          ${section.steps.map(s => `<li><strong>${s.title}</strong>: ${s.description}</li>`).join("")}
        </ol>`;
    }

    if (section.type === "badge_preview") {
      el.innerHTML = `<h2>${section.title}</h2>
        ${section.badges.map(b => `
          <div class="badge">${b.emoji} <strong>${b.name}</strong><br>${b.requirements}</div>
        `).join("")}`;
    }

    if (section.type === "leaderboard_preview") {
      el.innerHTML = `<h2>${section.title}</h2>
        <table>
          <tr><th>Rank</th><th>Wallet</th><th>Score</th></tr>
          ${section.wallets.map(w => `
            <tr><td>${w.rank}</td><td>${w.wallet}</td><td>${w.score}</td></tr>
          `).join("")}
        </table>
        <p>${section.note}</p>
      `;
    }

    if (section.type === "cta") {
      el.innerHTML = `
        <h2>${section.title}</h2>
        <p>${section.subtitle}</p>
        <button onclick="window.location.href='${section.ctaButton.link}'">${section.ctaButton.label}</button>
      `;
    }

    if (section.type === "footer") {
      el.innerHTML = `
        <footer>
          ${section.links.map(l => `<a href="${l.url}" target="_blank">${l.label}</a>`).join(" | ")}
          <p>${section.copyright}</p>
        </footer>
      `;
    }

    app.appendChild(el);
  });
}
loadPage();