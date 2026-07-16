import { defaultInterviewerTemplates } from "../domain/interviewerTemplates";
import { prisma } from "./prisma";
import { seedAlibabaMediaModels, seedMockAiModels } from "./seedAiModels";

const demoCompany = {
  id: "demo-company",
  name: "示例科技公司",
  industry: "互联网",
  interviewStyle: "标准 HR + 业务主管复试，重视表达结构和项目结果。",
  competencyModel: "沟通表达、岗位理解、项目结果、协作能力、抗压能力",
  commonQuestions: "请做一个自我介绍。你为什么选择我们公司？讲一个最有代表性的项目。",
  scoringStandard: "表达清晰度、岗位匹配度、经历可信度、追问稳定性",
  restrictedTopics: "[]"
};

const demoJob = {
  id: "demo-product-manager",
  title: "产品经理",
  category: "产品",
  competencyModel: "用户理解、需求分析、数据意识、跨团队协作、结果复盘",
  commonQuestions: "你如何判断一个需求是否值得做？讲一个你推动项目落地的经历。",
  riskQuestions: "如果业务方和技术团队意见冲突，你怎么处理？"
};

async function main() {
  for (const template of defaultInterviewerTemplates) {
    await prisma.interviewerTemplate.upsert({
      where: { type: template.type },
      update: {
        type: template.type,
        name: template.name,
        tone: template.tone,
        followUpDepth: template.followUpDepth,
        interruptFrequency: template.interruptFrequency,
        challengeIntensity: template.challengeIntensity,
        languageMode: template.languageMode,
        safetyBoundary: template.safetyBoundary
      },
      create: {
        id: template.type,
        type: template.type,
        name: template.name,
        tone: template.tone,
        followUpDepth: template.followUpDepth,
        interruptFrequency: template.interruptFrequency,
        challengeIntensity: template.challengeIntensity,
        languageMode: template.languageMode,
        safetyBoundary: template.safetyBoundary
      }
    });
  }

  await prisma.companyTemplate.upsert({
    where: { id: demoCompany.id },
    update: demoCompany,
    create: demoCompany
  });

  await prisma.jobTemplate.upsert({
    where: { id: demoJob.id },
    update: demoJob,
    create: demoJob
  });

  await prisma.aiServiceProvider.upsert({
    where: { id: "mock-provider" },
    update: {
      displayName: "Mock AI",
      providerType: "MOCK",
      enabled: true,
      notes: "本地演示与开发使用的模拟 AI 服务。"
    },
    create: {
      id: "mock-provider",
      displayName: "Mock AI",
      providerType: "MOCK",
      enabled: true,
      notes: "本地演示与开发使用的模拟 AI 服务。"
    }
  });

  await seedMockAiModels(prisma);
  await seedAlibabaMediaModels(prisma);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
