import { describe, expect, it } from "vitest"
import { isRichText, normalizeRichText, richTextToPlain, richTextToSafeHtml, sanitizeRichText } from "./sanitize"

describe("sanitizeRichText", () => {
  it("keeps the editor's formatting", () => {
    const html = '<b>Bold</b> <i>it</i> <u>u</u> <s>s</s><ul><li>one</li></ul><ol><li>two</li></ol><hr><div style="text-align: center">c</div>'
    expect(sanitizeRichText(html)).toBe(html)
  })
  it("normalises legacy tags and font sizes/colors", () => {
    expect(sanitizeRichText('<strong>a</strong><em>b</em><strike>c</strike><font size="5" color="#ff0000">d</font>'))
      .toBe('<b>a</b><i>b</i><s>c</s><span style="color: #ff0000; font-size: 24px">d</span>')
    expect(sanitizeRichText('<span style="font-size: 13px; background-color: rgb(255, 255, 0)">x</span>'))
      .toBe('<span style="font-size: 13px; background-color: rgb(255, 255, 0)">x</span>')
  })
  it.each([
    ['<img src=x onerror=alert(1)>', ""],
    ['<script>alert(1)</script>ok', "ok"],
    ['<style>body{}</style>ok', "ok"],
    ['<b onclick="x()">a</b>', "<b>a</b>"],
    ['<a href="javascript:alert(1)">x</a>', "<span>x</span>"],
    ['<a href="java\tscript:alert(1)">x</a>', "<span>x</span>"],
    ['<a href="&#106;avascript:alert(1)">x</a>', "<span>x</span>"],
    ['<span style="background:url(javascript:x)">x</span>', "<span>x</span>"],
    ['<span style="color: expression(alert(1))">x</span>', "<span>x</span>"],
    ['<svg><script>x</script></svg>t', "t"],
    ['<iframe src="//evil"></iframe>t', "t"],
    ['a < b > c & d', "a &lt; b &gt; c &amp; d"],
    ['<b>unclosed', "<b>unclosed</b>"],
    ['</b>stray', "stray"],
    ['<!-- <script>x</script> -->t', "t"],
    ['<a title="x>y" href="https://a.b">l</a>', '<span>y" href="https://a.b"&gt;l</span>'],
  ])("neutralises %s", (input, expected) => {
    expect(sanitizeRichText(input)).toBe(expected)
  })
  it("keeps safe links with hardened rel", () => {
    expect(sanitizeRichText('<a href="https://elite.sa/terms">terms</a>')).toBe('<a href="https://elite.sa/terms" target="_blank" rel="noopener noreferrer nofollow">terms</a>')
  })
  it("caps nesting depth", () => {
    expect(sanitizeRichText("<b>".repeat(200) + "x")).not.toContain("x")
  })
})

describe("display helpers", () => {
  it("escapes legacy plain text and keeps its line breaks", () => {
    expect(isRichText("Pay within 30 days\nThanks <3")).toBe(false)
    expect(richTextToSafeHtml("Pay within 30 days\nThanks <3")).toBe("Pay within 30 days<br>Thanks &lt;3")
  })
  it("extracts plain text", () => {
    expect(richTextToPlain("<b>Terms</b><ul><li>One</li><li>Two &amp; three</li></ul>")).toBe("Terms\n• One\n• Two & three")
    expect(richTextToPlain("plain")).toBe("plain")
  })
  it("treats an empty editor as empty", () => {
    expect(normalizeRichText("<div><br></div>")).toBe("")
    expect(normalizeRichText("<b>x</b>")).toBe("<b>x</b>")
  })
})
