const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches

document.addEventListener("keydown", (event) => {
  if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return
  const card = event.target.closest("[data-shot]")
  if (!card) return
  const direction = event.key === "ArrowUp" ? "up" : "down"
  const form = card.querySelector(`form[data-move="${direction}"]`)
  if (!form) return
  event.preventDefault()
  form.requestSubmit()
})

if (!reduce) {
  document.querySelectorAll(".frame").forEach((frame) => {
    frame.addEventListener("pointermove", (event) => {
      const rect = frame.getBoundingClientRect()
      frame.style.setProperty("--px", `${((event.clientX - rect.left) / rect.width) * 100}%`)
      frame.style.setProperty("--py", `${((event.clientY - rect.top) / rect.height) * 100}%`)
    })
  })
}
