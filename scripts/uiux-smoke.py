#!/usr/bin/env python3
"""Read-only browser smoke for TCP role navigation and protected-route feedback."""

import os
import sys
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("TCP_UIUX_BASE_URL", "http://localhost:18081")
PASSWORD = os.environ.get("TCP_UIUX_PASSWORD")


def require_password() -> str:
    if not PASSWORD:
        raise SystemExit(
            "Set TCP_UIUX_PASSWORD before running this read-only browser smoke."
        )
    return PASSWORD


def login(page, username: str, password: str) -> None:
    page.goto(f"{BASE_URL}/login", wait_until="networkidle")
    page.locator("input").nth(0).fill(username)
    page.locator("input").nth(1).fill(password)
    page.get_by_role("button", name="登录").click()
    page.wait_for_timeout(500)


def check_default_routes(
    browser, password: str, username: str, path: str, heading: str | None
) -> None:
    """Login lands on the role's default route (defaultRouteFor); heading=None
    anchors on the stable nav entry instead (the Member dashboard h1 varies
    with the business stage, e.g. 自评已提交)."""
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    try:
        login(page, username, password)
        # SPA <Navigate> to the default route; allow a trailing ?year=YYYY query.
        page.wait_for_url(f"{BASE_URL}{path}*", timeout=10000)
        assert urlsplit(page.url).path == path, page.url
        if heading:
            assert page.get_by_role("heading", name=heading, exact=True).is_visible()
        else:
            assert page.get_by_role("link", name="我的工作台", exact=True).is_visible()
        print(f"PASS default-route {username} -> {path}")
    finally:
        page.close()


def check_member_navigation(browser, password: str) -> None:
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    try:
        login(page, "member", password)
        for link, path in (
            ("我的工作台", "/dashboard/member"),
            ("能力评级与提升计划", "/capability/assessment"),
            ("年度成长计划", "/growth/annual-plan"),
            # Issue #194 B1: M04 学习任务为独立页面。
            ("学习任务", "/growth/tasks"),
        ):
            page.get_by_role("link", name=link, exact=True).click()
            # SPA 客户端导航可能在 networkidle 之后才落地；先等到预期 path
            # （允许 ?year= 查询串）再断言，消除时序假阴性。
            page.wait_for_url(f"{BASE_URL}{path}*", timeout=10000)
            assert urlsplit(page.url).path == path, page.url
        print("PASS member-core-navigation")
    finally:
        page.close()


def check_buddy_redirects(browser, password: str) -> None:
    """Issue #194 P1-3: retired buddy routes redirect to evidence review."""
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    try:
        login(page, "buddy", password)
        for path in ("/mentoring/dashboard", "/mentoring/assessment-review"):
            page.goto(f"{BASE_URL}{path}", wait_until="networkidle")
            assert urlsplit(page.url).path == "/mentoring/evidence-review", page.url
            assert page.get_by_role("heading", name="成果验收", exact=True).is_visible()
        # The retired self-review center entry is gone.
        assert page.get_by_text("Buddy 复核中心").count() == 0
        print("PASS buddy-legacy-redirect")
    finally:
        page.close()


def check_protected_route(browser, password: str) -> None:
    """One real no-permission check: Buddy cannot manage system users."""
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    try:
        login(page, "buddy", password)
        page.goto(f"{BASE_URL}/system/users", wait_until="networkidle")
        assert page.get_by_text(
            "无权限，仅 Admin 可管理系统。", exact=True
        ).is_visible()
        print("PASS protected-route buddy -> /system/users")
    finally:
        page.close()


def main() -> None:
    password = require_password()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for case in (
                ("member", "/dashboard/member", None),
                ("buddy", "/mentoring/evidence-review", "成果验收"),
                ("leader", "/operations/analytics", "团队能力分析"),
                ("admin", "/system/users", "系统管理"),
            ):
                check_default_routes(browser, password, *case)
            check_member_navigation(browser, password)
            check_buddy_redirects(browser, password)
            check_protected_route(browser, password)
        finally:
            browser.close()


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print(f"FAIL {error}", file=sys.stderr)
        raise SystemExit(1) from error
