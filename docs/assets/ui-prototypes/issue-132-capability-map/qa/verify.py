from pathlib import Path

from PIL import Image, ImageDraw
from playwright.sync_api import expect, sync_playwright


PROTOTYPE = Path(__file__).resolve().parents[1]
REPO = Path(__file__).resolve().parents[5]
BASE_URL = "http://127.0.0.1:8132/index.html"
SOURCE_1440 = (
    REPO
    / "frontend/tests/e2e/visual/capability-map.spec.ts-snapshots"
    / "capability-map-1440x900-chromium-linux.png"
)


def assert_no_horizontal_overflow(page):
    overflow = page.evaluate(
        "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
    )
    assert overflow <= 0, f"horizontal overflow: {overflow}px"


def compare(source_path: Path, implementation_path: Path, output_path: Path, crop=None):
    source = Image.open(source_path).convert("RGB")
    implementation = Image.open(implementation_path).convert("RGB")
    if crop:
        source = source.crop(crop)
        implementation = implementation.crop(crop)
    label_height = 28
    canvas = Image.new(
        "RGB",
        (source.width + implementation.width, max(source.height, implementation.height) + label_height),
        "white",
    )
    draw = ImageDraw.Draw(canvas)
    draw.text((12, 8), "SOURCE: current TCP capability-map baseline", fill="#101828")
    draw.text(
        (source.width + 12, 8),
        "IMPLEMENTATION: Issue #132 interactive prototype",
        fill="#101828",
    )
    canvas.paste(source, (0, label_height))
    canvas.paste(implementation, (source.width, label_height))
    canvas.save(output_path)


def run():
    evidence = PROTOTYPE / "qa"
    evidence.mkdir(exist_ok=True)
    browser_errors = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on(
            "console",
            lambda message: browser_errors.append(f"console:{message.text}")
            if message.type == "error"
            else None,
        )
        page.on("pageerror", lambda error: browser_errors.append(f"pageerror:{error}"))

        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        expect(page.get_by_role("tab", name="P01 Data Infra 能力")).to_have_attribute(
            "aria-selected", "true"
        )
        assert page.url.endswith("/index.html")
        assert_no_horizontal_overflow(page)
        page.mouse.move(0, 0)
        default_1440 = evidence / "prototype-default-1440x900.png"
        page.screenshot(path=default_1440, full_page=True)

        page.get_by_role("tab", name="P02 AI Infra / Agent 能力").click()
        assert page.url.endswith("#P02")
        page.locator('[data-l2-code="P02.02"]').click()
        assert page.url.endswith("#P02.02")
        expect(page.locator('[data-l2-code="P02.02"]')).to_have_attribute(
            "aria-expanded", "true"
        )

        search = page.get_by_role("combobox", name="搜索能力地图")
        search.fill("P02.02.08")
        expect(page.get_by_role("listbox")).to_be_visible()
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        assert page.url.endswith("#P02.02.08")
        target = page.locator('[data-l3-code="P02.02.08"]')
        expect(target).to_be_focused()
        expect(target).to_have_attribute("aria-current", "location")

        page.reload()
        page.wait_for_load_state("networkidle")
        expect(page.get_by_role("tab", name="P02 AI Infra / Agent 能力")).to_have_attribute(
            "aria-selected", "true"
        )
        expect(page.locator('[data-l2-code="P02.02"]')).to_have_attribute(
            "aria-expanded", "true"
        )
        expect(page.locator('[data-l3-code="P02.02.08"]')).to_have_attribute(
            "aria-current", "location"
        )

        page.get_by_role("tab", name="C01 基本办公能力").click()
        assert page.url.endswith("#C01")
        page.go_back()
        expect(page.locator('[data-l3-code="P02.02.08"]')).to_have_attribute(
            "aria-current", "location"
        )
        page.go_forward()
        expect(page.get_by_role("tab", name="C01 基本办公能力")).to_have_attribute(
            "aria-selected", "true"
        )

        page.evaluate("location.hash = '#P01.01.01'")
        expect(page.locator('[data-l3-code="P01.01.01"]')).to_be_focused()
        expect(page.locator('[data-l3-code="P01.01.01"]')).to_have_attribute(
            "aria-current", "location"
        )

        page.goto(BASE_URL + "#P02.02")
        page.locator('[data-level-code="P02.02"][data-level="P5"]').click()
        full_requirement = page.locator(".inline-level-description p")
        expect(full_requirement).to_be_visible()
        assert (
            full_requirement.inner_text()
            != page.locator(
                '[data-level-code="P02.02"][data-level="P5"] span'
            ).inner_text()
        )
        page.mouse.move(0, 0)
        page.screenshot(
            path=evidence / "prototype-l2-P5-requirement-1440x900.png",
            full_page=True,
        )

        page.locator('[data-l3-code="P02.02.08"]').click()
        dialog = page.get_by_role("dialog", name="P02.02.08")
        expect(dialog).to_be_visible()
        expect(dialog).to_be_focused()
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(page.locator('[data-l3-code="P02.02.08"]')).to_be_focused()

        search.fill("P02.02")
        page.keyboard.press("End")
        active_id = search.get_attribute("aria-activedescendant")
        assert active_id
        page.mouse.move(0, 0)
        page.screenshot(
            path=evidence / "prototype-search-keyboard-1440x900.png",
            full_page=True,
        )
        page.keyboard.press("Escape")
        expect(page.get_by_role("listbox")).to_be_hidden()
        assert search.input_value() == "P02.02"
        page.get_by_role("button", name="清除").click()
        assert search.input_value() == ""
        assert page.url.endswith("#P02.02.08")

        page.goto(BASE_URL + "#P02.02.99")
        expect(page.get_by_role("alert")).to_contain_text("P02.02.99")
        expect(page.get_by_role("tab", name="P02 AI Infra / Agent 能力")).to_have_attribute(
            "aria-selected", "true"
        )
        invalid_recognized = evidence / "prototype-invalid-P02-1440x900.png"
        page.screenshot(path=invalid_recognized, full_page=True)

        page.goto(BASE_URL + "#NOT-A-CODE")
        expect(page.get_by_role("heading", name="这个链接没有对应的能力域、能力标准或达成路径")).to_be_visible()
        assert (
            page.locator('.domain-tab[aria-selected="true"]').count() == 0
        )
        page.get_by_role("button", name="清除无效路径并返回 P01").click()
        assert page.url.endswith("/index.html")
        expect(page.get_by_role("tab", name="P01 Data Infra 能力")).to_have_attribute(
            "aria-selected", "true"
        )

        search.fill("没有这个能力")
        expect(page.get_by_role("status")).to_contain_text("未找到")
        page.get_by_role("button", name="清除").click()

        page.goto(BASE_URL)
        selected_1440 = evidence / "prototype-selected-P02.02.08-1440x900.png"
        search.fill("P02.02.08")
        page.keyboard.press("Enter")
        page.mouse.move(0, 0)
        page.screenshot(path=selected_1440, full_page=True)
        assert_no_horizontal_overflow(page)

        for width, height, name in [
            (1920, 1080, "prototype-default-1920x1080.png"),
            (1024, 768, "prototype-default-1024x768.png"),
            (768, 1024, "prototype-default-768x1024.png"),
        ]:
            page.set_viewport_size({"width": width, "height": height})
            page.goto(BASE_URL)
            page.wait_for_load_state("networkidle")
            assert_no_horizontal_overflow(page)
            expect(page.get_by_role("combobox", name="搜索能力地图")).to_be_visible()
            page.mouse.move(0, 0)
            page.screenshot(path=evidence / name, full_page=True)

        assert not browser_errors, "\n".join(browser_errors)
        browser.close()

    compare(
        SOURCE_1440,
        default_1440,
        evidence / "compare-full-default-1440.png",
    )
    compare(
        SOURCE_1440,
        default_1440,
        evidence / "compare-focused-header-tabs-1440.png",
        crop=(0, 0, 1440, 650),
    )

    print("PASS: URL/hash, L1/L2/L3, refresh, back/forward, search keyboard, invalid links, L2 content, drawer focus")
    print("PASS: 1440/1920/1024/768 screenshots, zero horizontal overflow, zero browser errors")


if __name__ == "__main__":
    run()
