const { expect } = require('chai');
const fastify = require('fastify');
const sequelizePlugin = require('@kne/fastify-sequelize');
const imPlugin = require('../index');
const fs = require('fs');
const path = require('path');
const os = require('os');

let dbCounter = 0;

function getTempDbPath() {
  return path.join(os.tmpdir(), `fastify-im-test-${Date.now()}-${++dbCounter}.db`);
}

async function createTestApp(opts = {}) {
  const app = fastify();
  const dbPath = getTempDbPath();

  await app.register(sequelizePlugin, {
    db: {
      dialect: 'sqlite',
      storage: dbPath,
      logging: false
    },
    name: 'models'
  });

  // 创建模拟用户表 - 使用 STRING 主键与 IM 模型保持一致
  const { DataTypes } = require('sequelize');
  const UserModel = app.sequelize.instance.define('User', {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: DataTypes.STRING,
    nickname: DataTypes.STRING,
    username: DataTypes.STRING,
    avatar: DataTypes.STRING
  });

  const getUserModel = () => UserModel;

  const pluginName = opts.name || 'im';

  await app.register(imPlugin, {
    name: pluginName,
    getUserModel,
    prefix: `/${pluginName}`,
    sendOfflineMessages: opts.sendOfflineMessages,
    getParticipantInfo: opts.getParticipantInfo,
    verifyToken: opts.verifyToken,
    offlineNotifyInterval: opts.offlineNotifyInterval || 24,
    heartbeatInterval: opts.heartbeatInterval || 30000,
    ...opts
  });

  const namespace = app[pluginName];
  const { models } = namespace;

  // 先手动建立关联（在 sync 之前）
  Object.values(models).forEach(model => {
    if (model.associate) model.associate(models, app);
  });

  // 修复 underscored 模式下的索引问题
  Object.values(models).forEach(model => {
    if (model.options && model.options.indexes) {
      model.options.indexes.forEach(index => {
        if (index.fields) {
          index.fields = index.fields.map(field => {
            if (typeof field === 'string') {
              return field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
            }
            return field;
          });
        }
      });
    }
  });

  // 同步所有表
  await app.sequelize.instance.sync();

  // 预创建测试用户以满足外键约束
  // 使用固定 ID 以便其他代码可以通过 userId 引用
  const userIds = {
    user1: String(app.sequelize.generateId()),
    user2: String(app.sequelize.generateId()),
    user3: String(app.sequelize.generateId()),
    agent1: String(app.sequelize.generateId())
  };
  await UserModel.bulkCreate([
    { id: userIds.user1, name: 'User One', nickname: 'User1', username: 'user1', avatar: 'http://avatar1.url' },
    { id: userIds.user2, name: 'User Two', nickname: 'User2', username: 'user2', avatar: 'http://avatar2.url' },
    { id: userIds.user3, name: 'User Three', nickname: 'User3', username: 'user3', avatar: 'http://avatar3.url' },
    { id: userIds.agent1, name: 'Agent One', nickname: 'Agent1', username: 'agent1', avatar: 'http://agent1.url' }
  ]);

  app._userIdMap = userIds;
  app._testDbPath = dbPath;
  return app;
}

async function cleanupApp(app) {
  const dbPath = app._testDbPath;
  await app.close();
  if (dbPath && fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
}

module.exports = { expect, createTestApp, cleanupApp, fastify };
