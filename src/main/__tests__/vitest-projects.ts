export const packagingIntegrationTests = [
  'src/main/__tests__/packaged-helpers.integration.test.ts',
  'src/main/__tests__/release-packaging.integration.test.ts'
]

export const modelPortIntegrationTests = [
  'src/main/__tests__/model-server-chat.integration.test.ts',
  'src/renderer/src/components/setup/__tests__/HealthPanel.integration.test.tsx'
]

export interface VitestProjectDefinition {
  extends: true
  test: {
    name: string
    include: string[]
    exclude: string[]
    fileParallelism?: false
    sequence: { groupOrder: number }
  }
}

export function createVitestProjects(
  productTestFiles: string[],
  commonExcludes: string[]
): VitestProjectDefinition[] {
  return [
    {
      extends: true,
      test: {
        name: 'product-integration',
        include: productTestFiles,
        exclude: [...commonExcludes, ...modelPortIntegrationTests, ...packagingIntegrationTests],
        sequence: { groupOrder: 0 }
      }
    },
    {
      extends: true,
      test: {
        name: 'model-port-integration',
        include: modelPortIntegrationTests,
        exclude: commonExcludes,
        fileParallelism: false,
        sequence: { groupOrder: 1 }
      }
    },
    {
      extends: true,
      test: {
        name: 'packaging-integration',
        include: packagingIntegrationTests,
        exclude: commonExcludes,
        fileParallelism: false,
        sequence: { groupOrder: 2 }
      }
    }
  ]
}
