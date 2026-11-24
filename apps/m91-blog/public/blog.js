// The M91 blog's one script (served from this site, loaded with defer). Small reading helps; every page works without it.
//   - "On this page": the section being read is marked, in the side list and the phone menu.
//   - Code blocks get a Copy button; heading links and "Copy link" copy the address.
//   - A picture in a post opens large on a click (Esc or a click closes it).
//   - "Back to the top" shows once you have scrolled; the reading bar moves where CSS scroll timelines are missing.
(function () {
  'use strict'
  var doc = document.documentElement
  doc.classList.add('js')

  var note
  function say(text) {
    if (!note) {
      note = document.createElement('div')
      note.className = 'blog-note'
      note.setAttribute('role', 'status')
      document.body.appendChild(note)
    }
    note.textContent = text
    note.classList.add('show')
    clearTimeout(say.t)
    say.t = setTimeout(function () { note.classList.remove('show') }, 1800)
  }
  function copy(text, done) {
    var ok = function () { say(done) }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { say('Could not copy: select it instead') })
    else say('Could not copy: select it instead')
  }

  // ---------- the section being read ----------
  var links = Array.prototype.slice.call(document.querySelectorAll('.toc a[href^="#"]'))
  var seen = {}
  var heads = []
  links.forEach(function (a) {
    var id = decodeURIComponent(a.getAttribute('href').slice(1))
    if (seen[id]) return
    seen[id] = true
    var el = document.getElementById(id)
    if (el) heads.push(el)
  })
  var current = null
  function mark(id) {
    if (id === current) return
    current = id
    links.forEach(function (a) {
      var on = decodeURIComponent(a.getAttribute('href').slice(1)) === id
      a.classList.toggle('is-current', on)
      if (on) a.setAttribute('aria-current', 'location')
      else a.removeAttribute('aria-current')
    })
    var label = document.querySelector('.toc-mobile .toc-now')
    var on = links.filter(function (a) { return a.classList.contains('is-current') })[0]
    if (label) label.textContent = on ? on.textContent : ''
  }
  function spy() {
    if (!heads.length) return
    var line = Math.max(140, window.innerHeight * 0.3)
    var id = null
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].getBoundingClientRect().top - line <= 0) id = heads[i].id
      else break
    }
    // At the very end of the page, the last section.
    if (window.innerHeight + window.scrollY >= doc.scrollHeight - 4) id = heads[heads.length - 1].id
    mark(id)
  }

  // ---------- the reading bar (only where CSS cannot move it) and "Back to the top" ----------
  var bar = document.querySelector('.read-bar')
  var cssBar = window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()')
  var toTop = document.querySelector('.to-top')
  function onScroll() {
    spy()
    if (bar && !cssBar) {
      var max = doc.scrollHeight - window.innerHeight
      bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, window.scrollY / max) : 0) + ')'
    }
    if (toTop) toTop.classList.toggle('show', window.scrollY > 900)
  }
  var frame = 0
  window.addEventListener('scroll', function () {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(onScroll)
  }, { passive: true })
  window.addEventListener('resize', onScroll)
  onScroll()

  // A choice in the phone menu closes it.
  var menu = document.querySelector('.toc-mobile')
  if (menu) menu.addEventListener('click', function (e) { if (e.target.closest('a')) menu.open = false })

  // ---------- copying ----------
  Array.prototype.forEach.call(document.querySelectorAll('.prose pre'), function (pre) {
    var code = pre.querySelector('code') || pre
    var b = document.createElement('button')
    b.type = 'button'
    b.className = 'copy-code'
    b.textContent = 'Copy'
    b.setAttribute('aria-label', 'Copy the code')
    b.addEventListener('click', function () { copy(code.innerText, 'Code copied') })
    pre.appendChild(b)
  })
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.anchor')
    if (a) {
      e.preventDefault()
      history.replaceState(null, '', a.getAttribute('href'))
      document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))).scrollIntoView({ behavior: 'smooth' })
      copy(location.href, 'Link to this section copied')
      return
    }
    var c = e.target.closest && e.target.closest('[data-copy-link]')
    if (c) {
      e.preventDefault()
      copy(c.getAttribute('data-copy-link'), 'Link copied')
    }
  })

  // ---------- a picture, large ----------
  var imgs = document.querySelectorAll('.prose img, .cover img')
  if (imgs.length && window.HTMLDialogElement) {
    var box = document.createElement('dialog')
    box.className = 'zoom'
    box.setAttribute('aria-label', 'The picture, large')
    var big = document.createElement('img')
    box.appendChild(big)
    document.body.appendChild(box)
    box.addEventListener('click', function () { box.close() })
    Array.prototype.forEach.call(imgs, function (img) {
      // Only a picture shown smaller than it is: there is more of it to see.
      var bigger = function () { return img.naturalWidth > img.clientWidth * 1.15 }
      var check = function () {
        var on = bigger()
        img.classList.toggle('zoomable', on)
        if (on) img.setAttribute('tabindex', '0')
        else img.removeAttribute('tabindex')
      }
      if (img.complete) check()
      else img.addEventListener('load', check)
      window.addEventListener('resize', check)
      var open = function () {
        if (!bigger()) return
        big.src = img.currentSrc || img.src
        big.alt = img.alt
        box.showModal()
      }
      img.addEventListener('click', open)
      img.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } })
    })
  }
})()
