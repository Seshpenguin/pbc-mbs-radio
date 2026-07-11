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
  <p><small>Web services provided by <a href="https://wiki.minecartrapidtransit.net/index.php/Pixl_Broadcasting_Corporation">PBC</a>. Funded by <a href="https://sineware.ca/pixl/">Global Affairs Pixl</a>.</small></p>
</footer>`;
  }
});
