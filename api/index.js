export default async function handler(req, res) {
  // POST 요청만 허용
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { model, messages } = req.body;

    // 전달받은 시장 데이터 로그 찍기 (Vercel 대시보드 Logs에서 확인 가능)
    console.log("Jev AI Request received:", JSON.stringify(messages));

    // Jev AI의 스켈핑 분석 로직 (필요에 따라 OpenAI API 등과 연동 확장 가능)
    // 현재는 테스트 및 기본 구동을 위해 고정된 지능형 응답 구조 반환
    const aiDecision = {
      probability: 0.88,
      reason: "대량 실체결 매수세 확인 및 호가창 허수 물량 없음. 진입 조건 충족."
    };

    const responsePayload = {
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify(aiDecision)
          }
        }
      ]
    };

    return res.status(200).json(responsePayload);

  } catch (error) {
    console.error("Jev Server Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
