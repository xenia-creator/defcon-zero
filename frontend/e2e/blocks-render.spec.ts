/**
 * The block canvas draws correctly: every text field fits inside its block with nothing overlapping,
 * the canvas has room for its zoom and trash controls on a 1366x768 laptop, and the toolbox flyout
 * stays next to the category list. Every test also fails if the page throws an uncaught error.
 */
import { expect, test as base, type Page } from '@playwright/test'

const mock = (page: Page, path: string, data: unknown = {}) => page.request.post(`http://localhost:8022/__mock/${path}`, { data })

const test = base.extend<{ crashes: string[] }>({
  crashes: [
    async ({ page }, use) => {
      const crashes: string[] = []
      page.on('pageerror', (e) => crashes.push(e.message))
      await mock(page, 'reset')
      await use(crashes)
      expect(crashes).toEqual([])
    },
    { auto: true },
  ],
})

/** A new team in Round 3's Build with blocks, with this canvas loaded. */
async function round3With(page: Page, layout: object) {
  await mock(page, 'goto', { index: 3 })
  await page.goto('/')
  await page.getByLabel('Username').fill('team1')
  await page.getByLabel('Password').fill('demo')
  await page.getByRole('button', { name: 'Request Clearance' }).click()
  await page.getByLabel('Nation name').fill('Red Fox Republic')
  await page.getByRole('button', { name: 'India' }).click()
  await page.getByRole('button', { name: 'Lock in' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Lock in' }).click()
  await expect(page.getByRole('tab', { name: '▦ Build with blocks' })).toHaveAttribute('aria-selected', 'true')
  await page.evaluate(
    (strategy) =>
      localStorage.setItem(
        'draft:1:foreign_aid',
        JSON.stringify({ saved_at: Date.now() + 100000, agent: { hand_code: 'def strategy(my_history, opp_history):\n    return 5\n', modules: [], strategy_blocks: strategy, mode: 'blocks' } }),
      ),
    layout,
  )
  await page.reload()
  await expect(page.locator('.blocklySvg').first()).toBeVisible()
  // Past fonts.ready and the re-measure that follows it
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
}

const number = (NUM: number) => ({ shadow: { type: 'fa_number', fields: { NUM } } })
const avg = (WHAT: string) => ({ block: { type: 'fa_opp_avg', fields: { WHAT } }, ...number(5) })
/** Blocks with long labels next to dropdowns and number slots: the ones that showed overlapping text. */
const TEXT_HEAVY = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'fa_strategy',
        x: 24,
        y: 24,
        deletable: false,
        fields: { SEND_DEFAULT: 5, RETURN_PCT_DEFAULT: 50 },
        inputs: {
          SEND: {
            block: {
              type: 'ic_if',
              inputs: {
                IF0: { block: { type: 'fa_first_time', fields: { ROLE: 'sending' } } },
                DO0: { block: { type: 'fa_send', inputs: { AMOUNT: avg('SEND') } } },
              },
              next: { block: { type: 'ic_if', inputs: { IF0: { block: { type: 'fa_opp_ever_short' } }, DO0: { block: { type: 'fa_send', inputs: { AMOUNT: number(0) } } } } } },
            },
          },
          RECEIVE: {
            block: {
              type: 'ic_if',
              inputs: {
                IF0: { block: { type: 'fa_compare', fields: { OP: 'GT' }, inputs: { A: { block: { type: 'fa_my_last', fields: { WHAT: 'SEND' } }, ...number(0) }, B: number(3) } } },
                DO0: { block: { type: 'fa_return', inputs: { AMOUNT: avg('RETURN_PCT') } } },
              },
            },
          },
        },
      },
    ],
  },
}

type Box = { left: number; top: number; right: number; bottom: number }
type Problem = string

/** Every text field against its own block and against the other fields on its row. */
const textProblems = (page: Page) =>
  page.evaluate((): Problem[] => {
    const problems: Problem[] = []
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    }
    const canvas = document.querySelector('.injectionDiv > svg.blocklySvg .blocklyBlockCanvas')!
    const blocks = [...canvas.querySelectorAll('g[data-id]')]
    if (blocks.length < 10) problems.push(`only ${blocks.length} blocks rendered`)
    for (const block of blocks) {
      const shape = block.querySelector(':scope > path.blocklyPath')
      if (!shape) continue
      const outline = box(shape)
      const texts = [...block.querySelectorAll('text.blocklyText')].filter((t) => t.closest('g[data-id]') === block && (t.textContent ?? '').trim() !== '')
      // A field with its own background (a dropdown or a number) is measured by that background, the rest by their text
      const fields = texts.map((t) => {
        const own = t.parentElement && t.parentElement !== block && t.parentElement.querySelector(':scope > rect') ? t.parentElement : t
        return { label: (t.textContent ?? '').trim(), text: box(t), field: box(own) }
      })
      for (const f of fields) {
        if (f.text.left < outline.left - 0.5 || f.text.right > outline.right + 0.5 || f.text.top < outline.top - 0.5 || f.text.bottom > outline.bottom + 0.5)
          problems.push(`"${f.label}" sticks out of its block`)
        if (f.text.right > f.field.right + 0.5 || f.text.left < f.field.left - 0.5) problems.push(`"${f.label}" sticks out of its field`)
      }
      // Fields on one row, left to right: each ends before the next begins
      const rows = new Map<number, typeof fields>()
      for (const f of fields) {
        const key = [...rows.keys()].find((y) => Math.abs(y - (f.text.top + f.text.bottom) / 2) < 6) ?? (f.text.top + f.text.bottom) / 2
        rows.set(key, [...(rows.get(key) ?? []), f])
      }
      for (const row of rows.values()) {
        row.sort((a, b) => a.field.left - b.field.left)
        for (let i = 1; i < row.length; i++)
          if (row[i - 1].field.right > row[i].field.left + 0.5) problems.push(`"${row[i - 1].label}" runs into "${row[i].label}"`)
      }
    }
    return problems
  })

test('every text field sits inside its block, and fields on a row never overlap', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await round3With(page, TEXT_HEAVY)
  const canvas = page.locator('.injectionDiv > svg.blocklySvg .blocklyBlockCanvas')
  await expect(canvas).toContainText('on average, what the opponent')
  await expect(canvas).toContainText('this is my first time')
  expect(await textProblems(page)).toEqual([])
})

/**
 * What is visible of a Blockly control: its sprite image is bigger than the icon it shows, so this
 * maps the icon's own size (Blockly's: 32px zoom buttons, a 47 x 60 trash) through the control's transform.
 */
const visible = (page: Page, selector: string, width: number, height: number) =>
  page.evaluate(
    ([selector, width, height]) =>
      [...document.querySelectorAll(selector)].map((g) => {
        const m = (g as SVGGraphicsElement).getScreenCTM()!
        const a = new DOMPoint(0, 0).matrixTransform(m)
        const b = new DOMPoint(width, height).matrixTransform(m)
        return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }
      }),
    [selector, width, height] as const,
  )
const union = (boxes: { x: number; y: number; width: number; height: number }[]) => {
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y }
}

/** The screen centre of the zoom-in button's visible icon. */
const zoomIn = (page: Page) =>
  page.evaluate(() => {
    const g = document.querySelector('.blocklyZoomIn') as SVGGraphicsElement
    const p = new DOMPoint(16, 16).matrixTransform(g.getScreenCTM()!)
    return { x: p.x, y: p.y }
  })
const scale = (page: Page) =>
  page.evaluate(() => {
    const m = /scale\(([\d.]+)/.exec(document.querySelector('.injectionDiv > svg.blocklySvg .blocklyBlockCanvas')!.getAttribute('transform') ?? '')
    return m ? Number(m[1]) : 1
  })

for (const height of [768, 657]) {
  test(`at 1366x${height} the canvas has room, and the zoom and trash controls stay inside it and above the blocks`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height })
    const external: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('blockly.com')) external.push(r.url())
    })
    // Parked in the clear space right of the strategy, away from the scrollbars
    const parked = { type: 'fa_send', x: 720, y: 30, inputs: { AMOUNT: number(10) } }
    await round3With(page, { blocks: { languageVersion: 0, blocks: [...TEXT_HEAVY.blocks.blocks, parked] } })
    const canvas = (await page.locator('.injectionDiv').first().boundingBox())!
    expect(canvas.height).toBeGreaterThanOrEqual(359)
    // The controls' icons come from this app, so they show on a LAN with no internet
    const sprite = await page.evaluate(() => {
      const image = document.querySelector('.injectionDiv .blocklyZoom image')
      return image?.getAttribute('href') ?? image?.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
    })
    expect(sprite).toBe('/blockly-media/sprites.svg')
    expect(await page.evaluate(() => fetch('/blockly-media/sprites.svg').then((r) => r.ok && r.headers.get('content-type')?.includes('svg')))).toBe(true)

    const zoom = union(await visible(page, '.injectionDiv .blocklyZoomIn, .injectionDiv .blocklyZoomOut, .injectionDiv .blocklyZoomReset', 32, 32))
    const [trash] = await visible(page, '.injectionDiv .blocklyTrash', 47, 60)
    for (const b of [zoom, trash]) {
      expect(b.y).toBeGreaterThanOrEqual(canvas.y)
      expect(b.y + b.height).toBeLessThanOrEqual(canvas.y + canvas.height)
      expect(b.x + b.width).toBeLessThanOrEqual(canvas.x + canvas.width)
    }
    // Zoom sits above the trash, never on it, so a zoom click can't open the trash's flyout
    expect(zoom.y + zoom.height).toBeLessThanOrEqual(trash.y)

    // A block dragged right under zoom-in: the button is still on top and still zooms
    const target = await zoomIn(page)
    const grip = (await page.locator('.injectionDiv > svg.blocklySvg .blocklyBlockCanvas > g[data-id]').last().locator('text.blocklyText').first().boundingBox())!
    await page.mouse.move(grip.x + 4, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(target.x, target.y, { steps: 15 })
    await page.mouse.up()
    const under = await page.evaluate(({ x, y }) => document.elementsFromPoint(x, y).some((e) => e.closest('g[data-id]')), target)
    expect(under).toBe(true)
    const on = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.blocklyZoomIn'), target)
    expect(on).toBe(true)
    const before = await scale(page)
    await page.mouse.click(target.x, target.y)
    await expect.poll(() => scale(page)).toBeGreaterThan(before)
    await expect(page.locator('.blocklyTrashcanFlyout:visible, svg.blocklyFlyout:visible')).toHaveCount(0)
    expect(external).toEqual([])
  })
}

test('the toolbox flyout opens next to the categories, also after a tab switch and a window resize', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await round3With(page, TEXT_HEAVY)
  const nextToToolbox = async () => {
    await page.getByRole('treeitem', { name: /Logic/ }).first().click()
    const flyout = page.locator('svg.blocklyFlyout:visible').first()
    await expect(flyout).toBeVisible()
    const toolbox = (await page.locator('.blocklyToolbox').first().boundingBox())!
    const box = (await flyout.boundingBox())!
    expect(Math.abs(box.x - (toolbox.x + toolbox.width))).toBeLessThanOrEqual(2)
    await page.keyboard.press('Escape')
    await page.locator('.blocklyMainBackground').first().click({ position: { x: 600, y: 40 } })
    await expect(page.locator('svg.blocklyFlyout:visible')).toHaveCount(0)
  }
  await nextToToolbox()
  await page.getByRole('tab', { name: '</> Write code' }).click()
  await page.getByRole('tab', { name: '▦ Build with blocks' }).click()
  await expect(page.locator('.blocklySvg').first()).toBeVisible()
  await nextToToolbox()
  await page.setViewportSize({ width: 1100, height: 700 })
  await page.setViewportSize({ width: 1366, height: 768 })
  await nextToToolbox()
})
