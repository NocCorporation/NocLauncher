const revealItems = document.querySelectorAll('.reveal');
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      io.unobserve(e.target);
    }
  });
}, { threshold: 0.15 });
revealItems.forEach((el) => io.observe(el));

const parallax = document.querySelector('.parallax');
window.addEventListener('mousemove', (e) => {
  if (!parallax) return;
  const depth = Number(parallax.dataset.depth || 12);
  const x = (window.innerWidth / 2 - e.clientX) / depth;
  const y = (window.innerHeight / 2 - e.clientY) / depth;
  parallax.style.transform = `translate(${x}px, ${y}px)`;
});