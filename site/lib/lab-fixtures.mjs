// Synthetic prescriptions and profiles only.
export const complexText=`Поддерживающее лечение
1. AlphaTabs 10 мг, таблетки — по 0,5 таблетки 2 раза в день после еды, курс 14 дней. С 6 лет.
2. BetaDrops 5 мг/мл, капли — по 4 капли 3 раза в день, курс 10 дней.
ИЛИ
3. GammaSpray 50 мкг/доза, спрей — по 1 впрыскиванию в каждую ноздрю 3 раза в день, курс 10 дней.
При обострении:
4. AcuteMix суспензия для ингаляций 0,25 мг/мл — по 1 мл 2 раза в день, курс 7 дней.
Смешать с 1 мл NaCl 0,9%. Ингаляция 7 минут.
5. DeltaSyrup 2 мг/мл, сироп — по 2,5 мл 1 раз в день в 17:00, курс 7 дней.`;
const slot=(id,time)=>({id,label:{breakfast:'Завтрак',lunch:'Обед',dinner:'Ужин',secondDinner:'Второй ужин'}[id],time});
export const demoContext={startDate:'2026-11-09',timeZone:'Europe/Chisinau',people:[{id:'alice',name:'Алиса',ageYears:4,daySlots:{weekday:[slot('breakfast','07:30'),slot('dinner','19:00'),slot('secondDinner','21:30')],weekend:[slot('breakfast','09:00'),slot('lunch','14:00'),slot('dinner','19:00'),slot('secondDinner','21:30')]}},{id:'danya',name:'Даня',ageYears:6,daySlots:{weekday:[slot('breakfast','07:30'),slot('lunch','13:30'),slot('dinner','19:00'),slot('secondDinner','21:30')],weekend:[slot('breakfast','09:00'),slot('lunch','14:00'),slot('dinner','19:00'),slot('secondDinner','21:30')]}}]};
