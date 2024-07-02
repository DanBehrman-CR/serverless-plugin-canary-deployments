/* eslint-disable no-template-curly-in-string */

import expect from 'chai'
import fp from 'lodash'
import CodeDeploy from './CodeDeploy'

describe('CodeDeploy', () => {
  describe('.buildApplication', () => {
    it('generates a CodeDeploy::Application resouce', () => {
      const expected = {
        Type: 'AWS::CodeDeploy::Application',
        Properties: { ComputePlatform: 'Lambda' }
      }
      const actual = CodeDeploy.buildApplication()
      expect(actual).to.deep.equal(expected)
    })
  })

  describe('.buildFnDeploymentGroup', () => {
    const codeDeployAppName = 'MyCDApp'
    const codeDeployGroupName = 'canary-deployments-test-dev-FirstLambdaFunctionDeploymentGroup'
    const baseDeploymentGroup = {
      Type: 'AWS::CodeDeploy::DeploymentGroup',
      Properties: {
        ApplicationName: {
          Ref: ''
        },
        DeploymentGroupName: '',
        AutoRollbackConfiguration: {
          Enabled: true,
          Events: [
            'DEPLOYMENT_FAILURE',
            'DEPLOYMENT_STOP_ON_ALARM',
            'DEPLOYMENT_STOP_ON_REQUEST'
          ]
        },
        ServiceRoleArn: {
          'Fn::GetAtt': [
            'CodeDeployServiceRole',
            'Arn'
          ]
        },
        DeploymentConfigName: {
          'Fn::Sub': [
            'CodeDeployDefault.Lambda${ConfigName}',
            { ConfigName: '' }
          ]
        },
        DeploymentStyle: {
          DeploymentType: 'BLUE_GREEN',
          DeploymentOption: 'WITH_TRAFFIC_CONTROL'
        }
      }
    }

    it('should generate a CodeDeploy::DeploymentGroup resouce for the provided function', () => {
      const deploymentSettings = {
        type: 'Linear10PercentEvery1Minute',
        alarms: ['Alarm1', { name: 'Alarm2' }]
      }
      const expectedAlarms = {
        Alarms: [{ Name: { Ref: 'Alarm1' } }, { Name: 'Alarm2' }],
        Enabled: true
      }
      const expected = fp.pipe(
        fp.set('Properties.ApplicationName', { Ref: codeDeployAppName }),
        fp.set('Properties.DeploymentGroupName', codeDeployGroupName),
        fp.set('Properties.AlarmConfiguration', expectedAlarms),
        fp.set('Properties.DeploymentConfigName.Fn::Sub[1].ConfigName', deploymentSettings.type)
      )(baseDeploymentGroup)
      const actual = CodeDeploy.buildFnDeploymentGroup({ codeDeployAppName, codeDeployGroupName, deploymentSettings })
      expect(actual).to.deep.equal(expected)
    })

    context('when no alarms were provided', () => {
      it('should not include the AlarmConfiguration property', () => {
        const deploymentSettings = { type: 'Linear10PercentEvery1Minute' }
        const expected = fp.pipe(
          fp.set('Properties.ApplicationName', { Ref: codeDeployAppName }),
          fp.set('Properties.DeploymentGroupName', codeDeployGroupName),
          fp.set('Properties.DeploymentConfigName.Fn::Sub[1].ConfigName', deploymentSettings.type)
        )(baseDeploymentGroup)
        const actual = CodeDeploy.buildFnDeploymentGroup({ codeDeployAppName, codeDeployGroupName, deploymentSettings })
        expect(actual).to.deep.equal(expected)
      })
    })

    context('when a codeDeploy role is provided', () => {
      it('should include the arn of the existing role instead of trying to lookup a generated role', () => {
        const deploymentSettings = { type: 'Linear10PercentEvery1Minute' }

        const codeDeployRoleArn = 'existing_role_arn'
        const expected = fp.pipe(
          fp.set('Properties.ServiceRoleArn', codeDeployRoleArn),
          fp.set('Properties.ApplicationName', { Ref: codeDeployAppName }),
          fp.set('Properties.DeploymentGroupName', codeDeployGroupName),
          fp.set('Properties.DeploymentConfigName.Fn::Sub[1].ConfigName', deploymentSettings.type)
        )(baseDeploymentGroup)
        const actual = CodeDeploy.buildFnDeploymentGroup({
          codeDeployAppName, codeDeployGroupName, codeDeployRoleArn, deploymentSettings
        })
        expect(actual).to.deep.equal(expected)
      })
    })

    context('when trigger configurations are provided', () => {
      it('should include the triggers in the DeploymentGroup resource', () => {
        const deploymentSettings = {
          type: 'Linear10PercentEvery1Minute',
          triggerConfigurations: [{
            TriggerName: 'rollbacks',
            TriggerEvents: [
              'DeploymentRollback'
            ],
            TargetTriggerArn: 'arn:aws:sns:region:account-id:my-sns-topic'
          }]
        }
        const expected = fp.pipe(
          fp.set('Properties.ApplicationName', { Ref: codeDeployAppName }),
          fp.set('Properties.DeploymentGroupName', codeDeployGroupName),
          fp.set('Properties.DeploymentConfigName.Fn::Sub[1].ConfigName', deploymentSettings.type),
          fp.set('Properties.TriggerConfigurations', deploymentSettings.triggerConfigurations)
        )(baseDeploymentGroup)

        const actual = CodeDeploy.buildFnDeploymentGroup({
          deploymentSettings,
          codeDeployAppName,
          codeDeployGroupName
        })

        expect(actual).to.deep.equal(expected)
      })
    })
  })
})
