import fs from 'fs'
import path from 'path'
import expect from 'chai'
import fp from 'lodash'
// import getInstalledPathSync from 'get-installed-path'
import ServerlessCanaryDeployments from './serverless-plugin-canary-deployments.js'
import Serverless from 'serverless'
import AwsProvider from './node_modules/serverless/lib/plugins/aws/provider.js'

// const serverlessPath = getInstalledPathSync('serverless', { local: true })
// import Serverless from "${serverlessPath}/lib/Serverless"
// const serverlessVersion = parseInt((new Serverless()).version)
// const AwsProvider = serverlessVersion > 1
//   ? require(`${serverlessPath}/lib/plugins/aws/provider`)
//   : require(`${serverlessPath}/lib/plugins/aws/provider/awsProvider`)
// const { expect } = chai
const fixturesPath = path.resolve(__dirname, 'fixtures')

describe('ServerlessCanaryDeployments', () => {
  const stage = 'dev'
  const options = { stage }

  describe('addCanaryDeploymentResources', () => {
    const testCaseFiles = fs.readdirSync(fixturesPath)
    const getTestCaseName = fp.pipe(fp.split('.'), fp.head)
    const testCaseFileType = fp.pipe(fp.split('.'), fp.get('[1]'))
    const testCaseContentsFromFiles = fp.reduce((acc, fileName) => {
      const contents = JSON.parse(fs.readFileSync(path.resolve(fixturesPath, fileName)))
      return fp.set(testCaseFileType(fileName), contents, acc)
    }, {})
    const testCaseFilesByName = fp.groupBy(getTestCaseName, testCaseFiles)
    this.testCases = fp.map(
      (caseName) => {
        const testCaseContents = testCaseContentsFromFiles(testCaseFilesByName[caseName])
        return Object.assign(testCaseContents, { caseName })
      },
      Object.keys(testCaseFilesByName)
    )

    this.testCases.forEach(({ caseName, input, output, service }) => {
      it(`generates the correct CloudFormation templates: test case ${caseName}`, () => {
        const serverless = new Serverless(options)
        Object.assign(serverless.service, service)
        serverless.service.provider.compiledCloudFormationTemplate = input
        serverless.setProvider('aws', new AwsProvider(serverless, options))
        const plugin = new ServerlessCanaryDeployments(serverless, options)
        plugin.addCanaryDeploymentResources()
        expect(serverless.service.provider.compiledCloudFormationTemplate).to.deep.equal(output)
      })
    })
  })
})
