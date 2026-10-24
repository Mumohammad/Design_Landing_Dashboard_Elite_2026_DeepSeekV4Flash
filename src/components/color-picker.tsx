"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface ColorPickerProps {
  label: string
  cssVar: string
  value: string
  onChange: (cssVar: string, value: string) => void
}

function subscribeToDocumentColors(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] })
  return () => observer.disconnect()
}

function getServerColorSnapshot() {
  return ""
}

export function ColorPicker(props: ColorPickerProps) {
  // Theme changes replace the draft; editing still works when onChange only
  // updates the document's CSS variable rather than echoing a new value prop.
  return <ColorPickerInput key={JSON.stringify([props.cssVar, props.value])} {...props} />
}

function ColorPickerInput({ label, cssVar, value, onChange }: ColorPickerProps) {
  const [localValue, setLocalValue] = React.useState(value)
  const getColorSnapshot = React.useCallback(
    () => window.getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim(),
    [cssVar]
  )
  const computedColor = React.useSyncExternalStore(subscribeToDocumentColors, getColorSnapshot, getServerColorSnapshot)

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value
    setLocalValue(newColor)
    onChange(cssVar, newColor)
  }

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setLocalValue(newValue)
    onChange(cssVar, newValue)
  }

  const displayColor = localValue.startsWith("#")
    ? localValue
    : computedColor.startsWith("#") ? computedColor : "#000000"

  return (
    <div className="space-y-2">
      <Label htmlFor={`color-${cssVar}`} className="text-xs font-medium">
        {label}
      </Label>
      <div className="flex items-start gap-2">
        <div className="relative">
          <Button
            type="button"
            variant="outline"
            className="h-8 w-8 p-0 overflow-hidden cursor-pointer"
            style={{ backgroundColor: displayColor }}
          >
            <input
              type="color"
              id={`color-${cssVar}`}
              value={displayColor}
              onChange={handleColorChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </Button>
        </div>
        <Input
          type="text"
          placeholder={`${cssVar} value`}
          value={localValue}
          onChange={handleTextChange}
          className="h-8 text-xs flex-1"
        />
      </div>
    </div>
  )
}
