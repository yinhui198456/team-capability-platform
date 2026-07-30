import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const viewports = [
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
] as const

for (const viewport of viewports) {
  test(`Issue #59 Leader standard matrix at ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.route('**/api/capability-model', (route) =>
      route.fulfill({
        status: 200,
        json: {
          id: 1,
          code: 'test-model',
          version: '1',
          domains: [
            {
              code: 'P01',
              name: '数据基础设施',
              overview: null,
              children: [
                {
                  code: 'P01.01',
                  name: '测试分类',
                  children: [
                    {
                      id: 101,
                      code: 'P01.01.01',
                      name: '标准矩阵达成路径',
                      recommended_start_level: 'P4',
                      materials_text: '',
                      expected_output: null,
                      estimated_hours: null,
                      output_type: null,
                      notes: null,
                      resources: [],
                      unmatched_materials: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    )
    await page.route('**/api/capability-standard-versions**', async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname.endsWith('/catalog-drift')) {
        await route.fulfill({
          status: 200,
          json: {
            has_drift: false,
            added_enabled_l3: [],
            disabled_l3: [],
            renamed_or_moved_l3: [],
          },
        })
        return
      }
      if (pathname.endsWith('/11')) {
        await route.fulfill({
          status: 200,
          json: {
            version: {
              id: 11,
              model_id: 1,
              version_no: 2,
              label: '标准版本 v2',
              status: '草稿',
              revision: 3,
              published_at: null,
            },
            items: ['P4', 'P5', 'P6', 'P7', 'P8'].map((job_level, index) => ({
              l3_node_id: 101,
              l1_code: 'P01',
              l1_name: '数据基础设施',
              l2_code: 'P01.01',
              l2_name: '测试分类',
              l3_code: 'P01.01.01',
              l3_name: '标准矩阵达成路径',
              job_level,
              applicable: true,
              target_level: index + 1,
              source: 'copied',
            })),
          },
        })
        return
      }
      await route.fulfill({
        status: 200,
        json: [
          {
            id: 11,
            model_id: 1,
            version_no: 2,
            label: '标准版本 v2',
            status: '草稿',
            revision: 3,
            published_at: null,
          },
        ],
      })
    })

    await loginAs(page, 'leader')
    await page.goto('/capability/standards')
    await page.getByRole('button', { name: /P01\.01.*测试分类/ }).click()
    await expect(page.getByTestId('standard-l2-P01.01')).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width)
    await expect(page).toHaveScreenshot(
      `capability-standard-versioning-${viewport.name}.png`,
      { fullPage: false },
    )
  })
}
