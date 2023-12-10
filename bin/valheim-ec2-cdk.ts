#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { ValheimStack } from '../lib/valheim/valheim-stack';
import { HuginbotStack } from '../lib/huginbot/huginbot-stack';

const app = new cdk.App();
new ValheimStack(app, 'ValheimStack');
new HuginbotStack(app, 'HuginbotStack');
