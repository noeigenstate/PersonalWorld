// Small original vector illustrations for overview labels. They express a city
// motif, not a reconstructed building or an assertion about a person's photos.
const lake = '<path d="M3 47 Q20 39 39 47 T77 45 V64 H3Z" fill="#83cbd1"/><path d="M7 52Q20 48 34 53M42 55Q55 50 71 53" fill="none" stroke="#e3f6e7" stroke-width="3" stroke-linecap="round"/>'
const tree = '<path d="M18 48V30" stroke="#a58b67" stroke-width="4" stroke-linecap="round"/><path d="M8 29Q5 19 15 17Q22 7 30 20Q37 30 27 33Q17 39 8 29" fill="#a9c77e" stroke="#739970" stroke-width="1.5"/>'
export function cityStamp(city: string) {
  const coast = /湛江|三亚|海口|厦门|青岛|大连|北海/.test(city)
  const shanghai = /上海/.test(city)
  const artwork = coast
    ? '<path d="M4 48Q34 29 77 48V62H4Z" fill="#ead2a0"/>' + lake + '<path d="M43 44L46 18H54L58 44Z" fill="#fff4d8" stroke="#b8997e" stroke-width="1.5"/><path d="M45 27H56M44 36H57" stroke="#7db7bf" stroke-width="4"/><path d="M44 18V11H56V18Z" fill="#78aeb6"/><path d="M41 11L50 5L59 11Z" fill="#d99570"/><path d="M12 43V27Q13 18 25 19M13 26Q7 17 3 24" fill="none" stroke="#82ad79" stroke-width="4" stroke-linecap="round"/>'
    : shanghai
      ? lake + '<path d="M45 52V8" stroke="#cf8f86" stroke-width="4"/><circle cx="45" cy="33" r="10" fill="#edb1a9" stroke="#b98078" stroke-width="1.5"/><circle cx="45" cy="17" r="6" fill="#efc0b4"/><path d="M34 56L40 41M56 56L50 41" stroke="#c5a997" stroke-width="4"/>' + tree
      : '<path d="M3 44Q14 15 30 31Q44 8 61 38Q67 28 77 43V61H3Z" fill="#bed49d"/>' + lake + '<path d="M27 45V32H55V45" fill="#f2d9ab" stroke="#b69b74" stroke-width="2"/><path d="M21 32Q32 31 41 22Q50 31 61 32L54 36H28Z" fill="#9eb7a3" stroke="#7c9889" stroke-width="1.5"/>' + tree
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 80 64'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('city-stamp')
  // Every character of this markup is a local constant. City text is never HTML.
  svg.innerHTML = '<circle cx="66" cy="13" r="8" fill="#f2cf89"/>' + artwork
  return svg
}
