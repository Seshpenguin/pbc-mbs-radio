customElements.define("mbs-footer", class extends HTMLElement {
  connectedCallback() {
    const year = new Date().getFullYear();
    this.innerHTML = `
<footer>
  <p><a href="https://www.youtube.com/@mbs_radio">MBS Radio on YouTube</a></p>
  <p class="footer-logos">
    <img src="/mbs_logo_transparent-01.png" alt="MBS">
    <img src="/feline-holdings-large.svg" alt="Feline Holdings">
    <img src="/pbc_logo_final_darkmode_transparent.png" alt="PBC">
  </p>
  <p>© ${year === 2026 ? "2026" : "2026 - " + year} MBS. A Feline Holdings company.</p>
  <p><small>Web services provided by <a href="https://wiki.minecartrapidtransit.net/index.php/Pixl_Broadcasting_Corporation">PBC</a>. Funded by <a href="https://sineware.ca/pixl/">Global Affairs Pixl</a>.<br>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px" aria-hidden="true"><line
      x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path
      d="M18 9a9 9 0 0 1-9 9"/></svg>
    GNU AGPL 3.0 Licensed - <a href="https://github.com/Seshpenguin/pbc-mbs-radio">source code</a>.</small></p>
</footer>`;
  }
});
