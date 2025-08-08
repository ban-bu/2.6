#!/usr/bin/env node
/**
 * MongoDB 连接测试脚本
 */

const mongoose = require('mongoose');
require('dotenv').config();

// MongoDB连接测试
const testMongoDBConnection = async () => {
    try {
        console.log('🔍 正在测试MongoDB连接...');
        
        // 检查环境变量
        if (!process.env.MONGODB_URI) {
            console.log('❌ 未找到MONGODB_URI环境变量');
            console.log('请在Railway仪表板中设置MONGODB_URI环境变量');
            return;
        }
        
        console.log('📡 连接字符串:', process.env.MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'));
        
        // 连接数据库
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        
        console.log('✅ MongoDB连接成功!');
        
        // 测试数据库操作
        const db = mongoose.connection;
        console.log('📊 数据库名称:', db.name);
        console.log('🔗 连接状态:', db.readyState === 1 ? '已连接' : '未连接');
        
        // 创建测试集合
        const testCollection = db.collection('test');
        await testCollection.insertOne({ 
            test: true, 
            timestamp: new Date(),
            message: 'MongoDB连接测试成功'
        });
        
        console.log('✅ 数据库写入测试成功!');
        
        // 清理测试数据
        await testCollection.deleteOne({ test: true });
        console.log('🧹 测试数据已清理');
        
        await mongoose.connection.close();
        console.log('🔌 连接已关闭');
        
    } catch (error) {
        console.error('❌ MongoDB连接失败:', error.message);
        console.log('💡 请检查:');
        console.log('   1. MONGODB_URI环境变量是否正确');
        console.log('   2. 网络连接是否正常');
        console.log('   3. 数据库用户权限是否正确');
    }
};

// 运行测试
testMongoDBConnection();