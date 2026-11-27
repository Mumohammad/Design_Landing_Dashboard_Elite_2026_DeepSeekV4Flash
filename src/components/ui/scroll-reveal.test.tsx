import { describe, expect, it } from "vitest"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ScrollReveal, StaggerContainer } from "./scroll-reveal"

describe("progressive interface visibility",()=>{
  it("retains server-rendered content before scripts or observers run",()=>{
    const html=renderToStaticMarkup(<ScrollReveal direction="up"><p>Driver records</p></ScrollReveal>)
    expect(html).toContain("Driver records")
    expect(html).not.toMatch(/opacity-0|visibility:hidden|display:none|translate-y/)
  })
  it("renders an operational reveal immediately without leaking control props",()=>{
    const html=renderToStaticMarkup(<ScrollReveal disabled delay={800} className="workspace-section"><button>Approve</button></ScrollReveal>)
    expect(html).toContain('class="workspace-section"')
    expect(html).toContain("Approve")
    expect(html).not.toMatch(/disabled=|opacity|transitionDelay/)
  })
  it("preserves all staggered children in their static operational order",()=>{
    const html=renderToStaticMarkup(<StaggerContainer disabled><p>Orders</p><p>Payroll</p></StaggerContainer>)
    expect(html.indexOf("Orders")).toBeLessThan(html.indexOf("Payroll"))
    expect(html).not.toMatch(/opacity-0|translate|transition/)
  })
})
