#!/usr/bin/env node
/**
 * Railway 部署前检查脚本
 * 验证项目配置是否适合Railway部署
 */

const fs = require('fs');
const path = require('path');

console.log('🚄 Railway 部署检查开始...\n');

// 检查必需文件
const requiredFiles = [
    'package.json',
    'server/server.js',
    'index.html',
    'railway.toml',
    'Procfile'
];

console.log('📁 检查必需文件...');
let filesOk = true;
requiredFiles.forEach(file => {
    if (fs.existsSync(file)) {
        console.log(`✅ ${file}`);
    } else {
        console.log(`❌ 缺少文件: ${file}`);
        filesOk = false;
    }
});

// 检查package.json配置
console.log('\n📦 检查 package.json...');
try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    
    if (packageJson.scripts && packageJson.scripts.start) {
        console.log('✅ 启动脚本已配置');
    } else {
        console.log('❌ 缺少启动脚本');
        filesOk = false;
    }
    
    if (packageJson.engines && packageJson.engines.node) {
        console.log('✅ Node.js 版本已指定');
    } else {
        console.log('⚠️  建议指定 Node.js 版本');
    }
    
    const requiredDeps = ['express', 'socket.io', 'cors'];
    const missing = requiredDeps.filter(dep => !packageJson.dependencies[dep]);
    if (missing.length === 0) {
        console.log('✅ 必需依赖已安装');
    } else {
        console.log(`❌ 缺少依赖: ${missing.join(', ')}`);
        filesOk = false;
    }
} catch (error) {
    console.log('❌ package.json 格式错误');
    filesOk = false;
}

// 检查Railway配置
console.log('\n🚄 检查 Railway 配置...');
try {
    const railwayConfig = fs.readFileSync('railway.toml', 'utf8');
    if (railwayConfig.includes('startCommand')) {
        console.log('✅ Railway 启动命令已配置');
    } else {
        console.log('❌ Railway 启动命令缺失');
        filesOk = false;
    }
} catch (error) {
    console.log('❌ railway.toml 读取失败');
    filesOk = false;
}

// 检查服务器配置
console.log('\n🖥️  检查服务器配置...');
try {
    const serverCode = fs.readFileSync('server/server.js', 'utf8');
    
    if (serverCode.includes('express.static')) {
        console.log('✅ 静态文件服务已配置');
    } else {
        console.log('❌ 静态文件服务缺失');
        filesOk = false;
    }
    
    if (serverCode.includes('railway.app')) {
        console.log('✅ Railway CORS 配置已添加');
    } else {
        console.log('❌ Railway CORS 配置缺失');
        filesOk = false;
    }
    
    if (serverCode.includes('process.env.PORT')) {
        console.log('✅ 动态端口配置正确');
    } else {
        console.log('❌ 端口配置有问题');
        filesOk = false;
    }
} catch (error) {
    console.log('❌ 服务器文件读取失败');
    filesOk = false;
}

// 检查前端配置
console.log('\n🌐 检查前端配置...');
try {
    const clientCode = fs.readFileSync('realtime-client.js', 'utf8');
    
    if (clientCode.includes('railway.app')) {
        console.log('✅ Railway 环境检测已添加');
    } else {
        console.log('❌ Railway 环境检测缺失');
        filesOk = false;
    }
} catch (error) {
    console.log('❌ 客户端文件读取失败');
    filesOk = false;
}

// 总结
console.log('\n' + '='.repeat(50));
if (filesOk) {
    console.log('🎉 检查通过！项目已准备好部署到Railway');
    console.log('\n下一步：');
    console.log('1. 将代码推送到 GitHub');
    console.log('2. 在 Railway 创建新项目');
    console.log('3. 连接 GitHub 仓库');
    console.log('4. 配置环境变量（如需要）');
    console.log('5. 等待部署完成');
    console.log('\n🔗 详细部署指南: ./RAILWAY_DEPLOY.md');
} else {
    console.log('❌ 检查失败！请修复上述问题后再部署');
    process.exit(1);
}

console.log('\n💡 提示：使用 npm run railway:check 运行此检查');