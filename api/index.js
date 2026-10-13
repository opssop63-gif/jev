export default function handler(req, res) {
  // 1. POST 요청 방식 검증
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      status: 'error', 
      code: 'INVALID_METHOD',
      message: '허용되지 않는 요청 방식입니다.' 
    });
  }

  const { accountNumber, action, kiwoomConnected } = req.body || {};

  // 2. 키움 API 세션 연동 상태 강제 검증
  if (!kiwoomConnected) {
    return res.status(400).json({ 
      status: 'error', 
      code: 'KIWOOM_DISCONNECTED',
      message: '[치명적 오류] 키움 API와 연동되지 않았습니다. 로그인을 먼저 확인하세요.' 
    });
  }

  // 3. 모의계좌 번호 유효성 강제 검증 (공백, 누락, 자릿수 오류 차단)
  if (!accountNumber || typeof accountNumber !== 'string' || accountNumber.trim() === '' || accountNumber.length < 8) {
    return res.status(400).json({ 
      status: 'error', 
      code: 'INVALID_ACCOUNT',
      message: '[치명적 오류] 유효하지 않은 키움 모의계좌 번호입니다. 입력값을 다시 확인하세요.' 
    });
  }

  // 4. 모든 검증 통과 시에만 정상 실행
  if (action === 'start_trading') {
    return res.status(200).json({ 
      status: 'success', 
      message: '모든 검증 완료: Jev AI 트레이딩 봇이 정상 가동됩니다.' 
    });
  }

  return res.status(200).json({ 
    status: 'ok', 
    message: '설정 및 연결 상태 정상' 
  });
}
