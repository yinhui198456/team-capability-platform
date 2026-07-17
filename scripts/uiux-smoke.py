#!/usr/bin/env python3
"""Read-only browser smoke for TCP role navigation and protected-route feedback."""

import os
import sys

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("TCP_UIUX_BASE_URL", "http://localhost:18081")
PASSWORD = os.environ.get("TCP_UIUX_PASSWORD")


def require_password() -> str:
    if not PASSWORD:
        raise SystemExit("Set TCP_UIUX_PASSWORD before running this read-only browser smoke.")
    return PASSWORD


def login(page, username: str, password: str) -> None:
    page.goto(f"{BASE_URL}/login", wait_until="networkidle")
    page.locator("input").nth(0).fill(username)
    page.locator("input").nth(1).fill(password)
    page.get_by_role("button", name="登录").click()
    page.wait_for_timeout(500)


def check_role_navigation(browser, password: str, username: str, link: str, path: str, heading: str) -> None:
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    try:
        login(page, username, password)
        page.get_by_role("link", name=link, exact=True).click()
        page.wait_for_load_state("networkidle")
        assert page.url.endswith(path), page.url
        assert page.get_by_role("heading", name=heading, exact=True).is_visible()
        print(f"PASS role-navigation {username} -> {path}")
    finally:
        page.close()


def check_member_navigation(browser, password: str) -> None:
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    try:
        login(page, "member", password)
        for link, path in (
            ("能力自评", "/capability/assessment"),
            ("Gap 分析", "/capability/gap"),
            ("年度成长计划", "/growth/annual-plan"),
            ("学习任务", "/growth/tasks"),
            ("成长档案", "/growth/profile"),
        ):
            page.get_by_role("link", name=link, exact=True).click()
            page.wait_for_load_state("networkidle")
            assert page.url.endswith(path), page.url
        print("PASS member-core-navigation")
    finally:
        page.close()


def check_protected_routes(browser, password: str) -> None:
    cases = (
        ("member", "/operations/analytics", "无权限，仅 Leader 可查看团队能力分析。"),
        ("buddy", "/system/users", "无权限，仅 Admin 可管理系统。"),
        ("admin", "/mentoring/evidence-review", "insufficient permissions"),
    )
    for username, path, message in cases:
        page = browser.new_page(viewport={"width": 1440, "height": 960})
        try:
            login(page, username, password)
            page.goto(f"{BASE_URL}{path}", wait_until="networkidle")
            assert page.get_by_text(message, exact=True).is_visible()
            print(f"PASS protected-route {username} -> {path}")
        finally:
            page.close()


def main() -> None:
    password = require_password()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for case in (
                ("member", "我的成长", "/dashboard/member", "我的成长总览"),
                ("buddy", "Buddy 审核中心", "/mentoring/dashboard", "Buddy 审核中心"),
                ("leader", "团队能力分析", "/operations/analytics", "团队能力分析"),
                ("admin", "系统管理", "/system/users", "系统管理"),
            ):
                check_role_navigation(browser, password, *case)
            check_member_navigation(browser, password)
            check_protected_routes(browser, password)
        finally:
            browser.close()


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print(f"FAIL {error}", file=sys.stderr)
        raise SystemExit(1) from error
