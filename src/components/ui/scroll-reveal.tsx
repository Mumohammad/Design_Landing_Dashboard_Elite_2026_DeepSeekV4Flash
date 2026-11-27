"use client"

import * as React from "react"

type RevealDirection = "up" | "down" | "left" | "right" | "scale" | "fade"
interface ScrollRevealProps {
  children: React.ReactNode
  direction?: RevealDirection
  delay?: number
  duration?: number
  threshold?: number
  once?: boolean
  className?: string
  /** Operational screens render immediately, without entrance effects. */
  disabled?: boolean
}
const entryTransforms: Record<RevealDirection,string> = {
  up:"translateY(16px)",down:"translateY(-16px)",left:"translateX(16px)",
  right:"translateX(-16px)",scale:"scale(0.98)",fade:"none",
}
function useReveal({direction="up",delay=0,duration=500,threshold=0.15,once=true,disabled=false,staggerDelay}:Omit<ScrollRevealProps,"children"|"className">&{staggerDelay?:number}) {
  const ref=React.useRef<HTMLDivElement>(null)
  React.useEffect(()=>{
    const element=ref.current
    if(!element||disabled||typeof IntersectionObserver==="undefined")return
    const media=window.matchMedia("(prefers-reduced-motion: reduce)")
    const animations=new Set<Animation>()
    const cancel=()=>{for(const animation of animations)animation.cancel();animations.clear()}
    const onMotionChange=()=>{if(media.matches)cancel()}
    const observer=new IntersectionObserver(([entry])=>{
      if(!entry.isIntersecting){if(!once)cancel();return}
      if(once)observer.unobserve(element)
      if(media.matches)return
      const targets=staggerDelay===undefined?[element]:Array.from(element.children)
      targets.forEach((target,index)=>{
        if(typeof target.animate!=="function")return
        const animation=target.animate([
          {opacity:0,transform:entryTransforms[direction]},
          {opacity:1,transform:"none"},
        ],{duration,delay:delay+index*(staggerDelay??0),easing:"cubic-bezier(0.4,0,0.2,1)"})
        animations.add(animation)
        animation.onfinish=()=>animations.delete(animation)
        animation.oncancel=()=>animations.delete(animation)
      })
    },{threshold,rootMargin:"0px 0px -40px 0px"})
    media.addEventListener("change",onMotionChange)
    observer.observe(element)
    return()=>{observer.disconnect();media.removeEventListener("change",onMotionChange);cancel()}
  },[direction,delay,duration,threshold,once,disabled,staggerDelay])
  return ref
}
/** Content is visible in server HTML and when scripting/motion is unavailable. */
export function ScrollReveal({children,className,...options}:ScrollRevealProps) {
  const ref=useReveal(options)
  return <div ref={ref} className={className}>{children}</div>
}
export function StaggerContainer({children,className,staggerDelay=80,direction="up",threshold=0.1,disabled=false}:{
  children:React.ReactNode
  className?:string
  staggerDelay?:number
  direction?:RevealDirection
  threshold?:number
  disabled?:boolean
}) {
  const ref=useReveal({direction,threshold,disabled,staggerDelay})
  return <div ref={ref} className={className}>{React.Children.toArray(children).map((child,index)=><div key={index}>{child}</div>)}</div>
}
